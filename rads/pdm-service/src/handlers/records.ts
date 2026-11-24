import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tablePrefix = requiredEnv("PDM_TABLE_PREFIX");
const ALGORITHM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each HTTP request costs far more than a DynamoDB page, so fill a larger response from several queries.
// The byte budget keeps the response under the Lambda limit for large records (finance averages ~5.9 KB).
const PAGE_ITEMS = 2000;
const PAGE_BYTES = 2_500_000;
const QUERY_LIMIT = 250;
const MAX_QUERY_ATTEMPTS = 8;

async function queryWithRetry(command: QueryCommand) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ddb.send(command);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ThrottlingException" || attempt >= MAX_QUERY_ATTEMPTS) {
        throw error;
      }
      const backoffMs = 50 * 2 ** attempt + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

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
  if (!ALGORITHM_ID.test(algorithmId)) {
    return jsonResponse(400, { error: "invalid algorithmId" });
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

  const items: Record<string, unknown>[] = [];
  let consumedCapacity = 0;
  let pageBytes = 0;
  let nextKey = exclusiveStartKey;
  do {
    const result = await queryWithRetry(
      new QueryCommand({
        TableName: `${tablePrefix}-${algorithmId}`,
        KeyConditionExpression: "AlgorithmId = :a",
        ExpressionAttributeValues: { ":a": algorithmId },
        Limit: QUERY_LIMIT,
        ExclusiveStartKey: nextKey,
        ReturnConsumedCapacity: "TOTAL",
      }),
    );
    for (const item of result.Items ?? []) {
      items.push(item);
      pageBytes += Buffer.byteLength(JSON.stringify(item));
    }
    consumedCapacity += result.ConsumedCapacity?.CapacityUnits ?? 0;
    nextKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (nextKey && items.length < PAGE_ITEMS && pageBytes < PAGE_BYTES);

  await costEvent(algorithmId, runId, CostPhase.Execution, "dynamodb", "read-capacity", consumedCapacity);

  // A standalone list aligned with `records`; the rads host assembles the DSAR trail from it and posts after
  // a successful DC app run. Record objects stay {recordId, data}, so the DC app never sees subject ids.
  const records = items.map((item) => ({ recordId: item.RecordId, data: item.Data }));
  const dataSubjectIds = items.map((item) => (typeof item.DataSubjectId === "string" ? item.DataSubjectId : ""));
  const nextCursor = nextKey ? Buffer.from(JSON.stringify(nextKey)).toString("base64url") : null;

  await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
  return jsonResponse(200, { algorithmId, records, dataSubjectIds, nextCursor });
};
