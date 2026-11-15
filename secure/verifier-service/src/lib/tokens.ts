import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import { JWT_AUDIENCES, JWT_ISSUER, signAccessToken } from "./jwt.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("ATTESTATION_SESSION_TABLE");

// Access tokens are self-contained ML-DSA-87 JWTs that downstream services verify locally against the public
// JWKS endpoint - no /validate round-trip. They are short-lived (2 hours) so a revoked session stops working
// once its access token expires. Refresh tokens stay opaque and stored hashed: the DB row is what makes
// revocation possible.
const ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
// The refresh token must outlive the access token, otherwise sce-unit's pre-expiry refresh can never succeed.
const REFRESH_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

function newRefreshToken(): string {
  return `rt_${randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function mintAccessToken(
  algorithmId: string,
  runId: string,
): Promise<{ accessToken: string; accessTokenExpiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL_SECONDS;
  const accessToken = await signAccessToken({
    iss: JWT_ISSUER,
    sub: algorithmId,
    aud: JWT_AUDIENCES,
    iat: now,
    exp,
    jti: randomBytes(16).toString("hex"),
    runId,
  });
  return { accessToken, accessTokenExpiresAt: new Date(exp * 1000).toISOString() };
}

export async function issueTokenPair(algorithmId: string, runId: string): Promise<TokenPair> {
  const sessionId = randomBytes(16).toString("hex");
  const refreshToken = newRefreshToken();
  const now = Date.now();
  const access = await mintAccessToken(algorithmId, runId);

  const write = await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        SessionId: sessionId,
        AlgorithmId: algorithmId,
        RunId: runId,
        RefreshTokenHash: hashToken(refreshToken),
        RefreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
        Revoked: false,
        CreatedAt: new Date(now).toISOString(),
      },
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "write-capacity",
    write.ConsumedCapacity?.CapacityUnits ?? 0,
  );

  return { accessToken: access.accessToken, refreshToken, accessTokenExpiresAt: access.accessTokenExpiresAt };
}

interface RefreshSession {
  sessionId: string;
  algorithmId: string;
  runId: string;
  refreshTokenExpiresAt: string;
  revoked: boolean;
}

async function findByRefreshHash(refreshToken: string, runId: string): Promise<RefreshSession | null> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "RefreshTokenIndex",
      KeyConditionExpression: "RefreshTokenHash = :h",
      ExpressionAttributeValues: { ":h": hashToken(refreshToken) },
      Limit: 1,
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  const item = out.Items?.[0];
  if (!item) return null;
  await costEvent(
    item.AlgorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    out.ConsumedCapacity?.CapacityUnits ?? 0,
  );
  return {
    sessionId: item.SessionId,
    algorithmId: item.AlgorithmId,
    runId: item.RunId,
    refreshTokenExpiresAt: item.RefreshTokenExpiresAt,
    revoked: item.Revoked,
  };
}

export interface RefreshedSession {
  algorithmId: string;
  tokens: TokenPair;
}

export async function refreshAccessToken(refreshToken: string, runId: string): Promise<RefreshedSession | null> {
  const session = await findByRefreshHash(refreshToken, runId);
  if (!session || session.revoked) return null;
  if (new Date(session.refreshTokenExpiresAt) < new Date()) return null;
  // The token's run_id comes from the session; a body runId that disagrees would misattribute the refresh.
  if (typeof session.runId !== "string" || session.runId !== runId) return null;

  const access = await mintAccessToken(session.algorithmId, session.runId);
  return {
    algorithmId: session.algorithmId,
    tokens: { accessToken: access.accessToken, refreshToken, accessTokenExpiresAt: access.accessTokenExpiresAt },
  };
}
