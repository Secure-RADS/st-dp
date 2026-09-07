import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "./env.js";
import { JWT_AUDIENCE, JWT_ISSUER, signAccessToken } from "./jwt.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("ATTESTATION_SESSION_TABLE");

// Access tokens are self-contained ES256 JWTs that downstream services verify locally against the public
// JWKS endpoint - no /validate round-trip. They are short-lived so a revoked session stops working within
// minutes. Refresh tokens stay opaque and stored hashed: the DB row is what makes revocation possible.
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60;

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

async function mintAccessToken(algorithmId: string): Promise<{ accessToken: string; accessTokenExpiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL_SECONDS;
  const accessToken = await signAccessToken({
    iss: JWT_ISSUER,
    sub: algorithmId,
    aud: JWT_AUDIENCE,
    iat: now,
    exp,
    jti: randomBytes(16).toString("hex"),
  });
  return { accessToken, accessTokenExpiresAt: new Date(exp * 1000).toISOString() };
}

export async function issueTokenPair(algorithmId: string): Promise<TokenPair> {
  const sessionId = randomBytes(16).toString("hex");
  const refreshToken = newRefreshToken();
  const now = Date.now();
  const access = await mintAccessToken(algorithmId);

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        SessionId: sessionId,
        AlgorithmId: algorithmId,
        RefreshTokenHash: hashToken(refreshToken),
        RefreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
        Revoked: false,
        CreatedAt: new Date(now).toISOString(),
      },
    }),
  );

  return { accessToken: access.accessToken, refreshToken, accessTokenExpiresAt: access.accessTokenExpiresAt };
}

interface RefreshSession {
  sessionId: string;
  algorithmId: string;
  refreshTokenExpiresAt: string;
  revoked: boolean;
}

async function findByRefreshHash(refreshToken: string): Promise<RefreshSession | null> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "RefreshTokenIndex",
      KeyConditionExpression: "RefreshTokenHash = :h",
      ExpressionAttributeValues: { ":h": hashToken(refreshToken) },
      Limit: 1,
    }),
  );
  const item = out.Items?.[0];
  if (!item) return null;
  return {
    sessionId: item.SessionId,
    algorithmId: item.AlgorithmId,
    refreshTokenExpiresAt: item.RefreshTokenExpiresAt,
    revoked: item.Revoked,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenPair | null> {
  const session = await findByRefreshHash(refreshToken);
  if (!session || session.revoked) return null;
  if (new Date(session.refreshTokenExpiresAt) < new Date()) return null;

  const access = await mintAccessToken(session.algorithmId);
  return { accessToken: access.accessToken, refreshToken, accessTokenExpiresAt: access.accessTokenExpiresAt };
}
