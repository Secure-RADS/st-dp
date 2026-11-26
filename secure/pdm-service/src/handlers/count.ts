import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("PDM_TABLE");

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

// Metadata-only count used by execution-service's size check. When `size` is set the count may stop early and
// be a lower bound; callers only need to know whether at least that many records exist.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  const algorithmId = event.queryStringParameters?.algorithmId;
  if (!algorithmId) {
    return jsonResponse(400, { error: "missing algorithmId" });
  }

  const size = event.queryStringParameters?.size;
  let atLeast: number | undefined;
  if (size !== undefined) {
    const parsed = Number(size);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return jsonResponse(400, { error: "invalid size" });
    }
    atLeast = parsed;
  }

  const runId = event.headers["x-run-id"] ?? "";
  let count = 0;
  let readCapacityUnits = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await queryWithRetry(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "AlgorithmId = :a",
        ExpressionAttributeValues: { ":a": algorithmId },
        Select: "COUNT",
        ExclusiveStartKey: exclusiveStartKey,
        ReturnConsumedCapacity: "TOTAL",
      }),
    );
    count += page.Count ?? 0;
    readCapacityUnits += page.ConsumedCapacity?.CapacityUnits ?? 0;
    if (atLeast !== undefined && count >= atLeast) break;
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  await costEvent(algorithmId, runId, CostPhase.Execution, "dynamodb", "read-capacity", readCapacityUnits);
  await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
  return jsonResponse(200, { algorithmId, count });
};
