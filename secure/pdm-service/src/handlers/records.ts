import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { verifyAccessToken } from "../lib/jwt.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tablePrefix = requiredEnv("PDM_TABLE_PREFIX");
const ALGORITHM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 500;
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
  const authorization = event.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "missing bearer token" });
  }
  const token = authorization.slice("Bearer ".length);

  const validation = await verifyAccessToken(token);
  if (!validation) {
    return jsonResponse(401, { error: "invalid token" });
  }
  if (!ALGORITHM_ID.test(validation.algorithmId)) {
    return jsonResponse(401, { error: "invalid token" });
  }
  const runId = validation.runId;

  let exclusiveStartKey: Record<string, unknown> | undefined;
  const cursor = event.queryStringParameters?.cursor;
  if (cursor) {
    exclusiveStartKey = decodeCursor(cursor);
    if (!exclusiveStartKey) {
      return jsonResponse(400, { error: "invalid cursor" });
    }
  }

  const result = await queryWithRetry(
    new QueryCommand({
      TableName: `${tablePrefix}-${validation.algorithmId}`,
      KeyConditionExpression: "AlgorithmId = :a",
      ExpressionAttributeValues: { ":a": validation.algorithmId },
      Limit: PAGE_SIZE,
      ExclusiveStartKey: exclusiveStartKey,
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    validation.algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    result.ConsumedCapacity?.CapacityUnits ?? 0,
  );

  // A standalone list aligned with `records`; the enclave assembles the DSAR trail from it and posts after a
  // successful DC app run. Record objects stay {recordId, data}, so the DC app never sees subject ids.
  const items = result.Items ?? [];
  const records = items.map((item) => ({ recordId: item.RecordId, data: item.Data }));
  const dataSubjectIds = items.map((item) => (typeof item.DataSubjectId === "string" ? item.DataSubjectId : ""));
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
    : null;

  await recordRequest(validation.algorithmId, runId, CostPhase.Execution, startedAt);
  return jsonResponse(200, { algorithmId: validation.algorithmId, records, dataSubjectIds, nextCursor });
};
