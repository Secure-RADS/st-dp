import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { costEvent, recordRequest } from "../lib/cost.js";
import { requiredEnv } from "../lib/env.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("PDM_TABLE");
const logServiceUrl = requiredEnv("LOG_SERVICE_URL");

const PAGE_SIZE = 500;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// DSAR trail: which data subjects a run actually read. Errors are swallowed so a log-service failure can't
// fail the records response, but the call is awaited so the request is actually sent before the handler
// returns - an un-awaited fetch can be frozen, and dropped, when Lambda freezes the environment.
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
  const startedAt = process.hrtime.bigint();
  const algorithmId = event.queryStringParameters?.algorithmId;
  if (!algorithmId) {
    return jsonResponse(400, { error: "missing algorithmId" });
  }
  const runId = event.headers["x-run-id"] ?? "";

  let exclusiveStartKey: Record<string, unknown> | undefined;
  const cursor = event.queryStringParameters?.cursor;
  if (cursor) {
    exclusiveStartKey = decodeCursor(cursor);
    if (!exclusiveStartKey) {
      return jsonResponse(400, { error: "invalid cursor" });
    }
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "AlgorithmId = :a",
      ExpressionAttributeValues: { ":a": algorithmId },
      Limit: PAGE_SIZE,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    "execution",
    "dynamodb",
    "read",
    Math.max(1, Buffer.byteLength(JSON.stringify(result.Items ?? []))),
  );

  const dataSubjectIds = (result.Items ?? [])
    .map((item) => item.DataSubjectId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  // DSAR trail: which data subjects this page actually read. Awaited so the request is not lost to a Lambda
  // freeze (bounded by the function timeout); failures are swallowed inside logSubjectAccess.
  await logSubjectAccess(algorithmId, runId || "unknown", dataSubjectIds);

  const records = (result.Items ?? []).map((item) => ({ recordId: item.RecordId, data: item.Data }));
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
    : null;

  await recordRequest(algorithmId, runId, "execution", startedAt);
  return jsonResponse(200, { algorithmId, records, nextCursor });
};
