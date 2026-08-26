import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "./env.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("ATTESTATION_SESSION_TABLE");

// Short-lived access token limits blast radius; longer refresh token avoids re-attesting on every call.
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Tokens are opaque and stored hashed - the DB row is the source of truth, not a self-contained signed blob.
export async function issueTokenPair(algorithmId: string): Promise<TokenPair> {
  const sessionId = randomBytes(16).toString("hex");
  const accessToken = newToken("at");
  const refreshToken = newToken("rt");
  const now = Date.now();
  const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        SessionId: sessionId,
        AlgorithmId: algorithmId,
        AccessTokenHash: hashToken(accessToken),
        RefreshTokenHash: hashToken(refreshToken),
        AccessTokenExpiresAt: accessTokenExpiresAt,
        RefreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
        Revoked: false,
        CreatedAt: new Date(now).toISOString(),
      },
    }),
  );

  return { accessToken, refreshToken, accessTokenExpiresAt };
}

interface Session {
  sessionId: string;
  algorithmId: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  revoked: boolean;
}

async function findByIndex(indexName: string, keyName: string, tokenHash: string): Promise<Session | null> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: `${keyName} = :h`,
      ExpressionAttributeValues: { ":h": tokenHash },
      Limit: 1,
    }),
  );
  const item = out.Items?.[0];
  if (!item) return null;
  return {
    sessionId: item.SessionId,
    algorithmId: item.AlgorithmId,
    accessTokenExpiresAt: item.AccessTokenExpiresAt,
    refreshTokenExpiresAt: item.RefreshTokenExpiresAt,
    revoked: item.Revoked,
  };
}

// What downstream services call to check whether an access token is currently valid.
export async function validateAccessToken(accessToken: string): Promise<Session | null> {
  const session = await findByIndex("AccessTokenIndex", "AccessTokenHash", hashToken(accessToken));
  if (!session || session.revoked) return null;
  if (new Date(session.accessTokenExpiresAt) < new Date()) return null;
  return session;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenPair | null> {
  const session = await findByIndex("RefreshTokenIndex", "RefreshTokenHash", hashToken(refreshToken));
  if (!session || session.revoked) return null;
  if (new Date(session.refreshTokenExpiresAt) < new Date()) return null;

  const newAccessToken = newToken("at");
  const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { SessionId: session.sessionId },
      UpdateExpression: "SET AccessTokenHash = :h, AccessTokenExpiresAt = :e",
      ExpressionAttributeValues: {
        ":h": hashToken(newAccessToken),
        ":e": accessTokenExpiresAt,
      },
    }),
  );

  return { accessToken: newAccessToken, refreshToken, accessTokenExpiresAt };
}
