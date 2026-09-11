import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { verifyAccessToken } from "../lib/jwt.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("PDM_TABLE");
const dataKeyTable = requiredEnv("DATA_KEY_TABLE");
const logServiceUrl = requiredEnv("LOG_SERVICE_URL");

const PAGE_SIZE = 500;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Fire-and-forget DSAR trail: which data subjects a run actually read. Best-effort so a log-service
// hiccup cannot block the enclave from getting its records.
async function logSubjectAccess(algorithmId: string, runId: string, dataSubjectIds: string[]): Promise<void> {
  if (dataSubjectIds.length === 0) return;
  try {
    await fetch(`${logServiceUrl}/subject-access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ algorithmId, runId, dataSubjectIds, timestamp: new Date().toISOString() }),
    });
  } catch (error) {
    console.error("subject-access log failed", error);
  }
}

function decodeCursor(cursor: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const authorization = event.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "missing bearer token" });
  }
  const token = authorization.slice("Bearer ".length);

  const validation = await verifyAccessToken(token);
  if (!validation) {
    return jsonResponse(401, { error: "invalid token" });
  }

  let exclusiveStartKey: Record<string, unknown> | undefined;
  const cursor = event.queryStringParameters?.cursor;
  if (cursor) {
    exclusiveStartKey = decodeCursor(cursor);
    if (!exclusiveStartKey) {
      return jsonResponse(400, { error: "invalid cursor" });
    }
  }

  let dataKey: string | undefined;
  if (!cursor) {
    const keyItem = await ddb.send(
      new GetCommand({ TableName: dataKeyTable, Key: { AlgorithmId: validation.algorithmId } }),
    );
    const stored = keyItem.Item?.DataKey;
    if (typeof stored !== "string" || stored.length === 0) {
      return jsonResponse(500, { error: "missing data key" });
    }
    dataKey = stored;
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "AlgorithmId = :a",
      ExpressionAttributeValues: { ":a": validation.algorithmId },
      Limit: PAGE_SIZE,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  const dataSubjectIds = (result.Items ?? [])
    .map((item) => item.DataSubjectId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  await logSubjectAccess(validation.algorithmId, event.headers["x-run-id"] ?? "unknown", dataSubjectIds);

  const records = (result.Items ?? []).map((item) => ({ recordId: item.RecordId, data: item.Data }));
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
    : null;

  return jsonResponse(200, { algorithmId: validation.algorithmId, records, dataKey, nextCursor });
};
