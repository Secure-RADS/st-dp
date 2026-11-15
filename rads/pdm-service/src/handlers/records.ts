import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("PDM_TABLE");

const PAGE_SIZE = 500;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
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
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    result.ConsumedCapacity?.CapacityUnits ?? 0,
  );

  // The host assembles the DSAR trail from these ids and posts it after a successful DC app run.
  const records = (result.Items ?? []).map((item) => ({
    recordId: item.RecordId,
    dataSubjectId: item.DataSubjectId,
    data: item.Data,
  }));
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
    : null;

  await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
  return jsonResponse(200, { algorithmId, records, nextCursor });
};
