import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import { logSubjectAccess } from "@srads/common/log";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { verifyAccessToken } from "../lib/jwt.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("PDM_TABLE");
const dataKeyTable = requiredEnv("DATA_KEY_TABLE");

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
  const authorization = event.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "missing bearer token" });
  }
  const token = authorization.slice("Bearer ".length);

  const validation = await verifyAccessToken(token);
  if (!validation) {
    return jsonResponse(401, { error: "invalid token" });
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

  let dataKey: string | undefined;
  if (!cursor) {
    const keyItem = await ddb.send(
      new GetCommand({ TableName: dataKeyTable, Key: { AlgorithmId: validation.algorithmId } }),
    );
    await costEvent(
      validation.algorithmId,
      runId,
      CostPhase.Execution,
      "dynamodb",
      "read",
      keyItem.Item ? Buffer.byteLength(JSON.stringify(keyItem.Item)) : 1,
    );
    const stored = keyItem.Item?.DataKey;
    if (typeof stored !== "string" || stored.length === 0) {
      await recordRequest(validation.algorithmId, runId, CostPhase.Execution, startedAt);
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
  await costEvent(
    validation.algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read",
    Math.max(1, Buffer.byteLength(JSON.stringify(result.Items ?? []))),
  );

  const dataSubjectIds = (result.Items ?? [])
    .map((item) => item.DataSubjectId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  // DSAR trail: which data subjects this page actually read. Awaited so the request is not lost to a Lambda
  // freeze (bounded by the function timeout); failures are swallowed inside logSubjectAccess.
  await logSubjectAccess(validation.algorithmId, runId || "unknown", dataSubjectIds);

  const records = (result.Items ?? []).map((item) => ({ recordId: item.RecordId, data: item.Data }));
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
    : null;

  await recordRequest(validation.algorithmId, runId, CostPhase.Execution, startedAt);
  return jsonResponse(200, { algorithmId: validation.algorithmId, records, dataKey, nextCursor });
};
