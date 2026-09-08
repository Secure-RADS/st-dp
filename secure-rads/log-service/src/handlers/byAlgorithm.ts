import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { type EventRow, toCsv } from "../lib/csv.js";
import { requiredEnv } from "../lib/env.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

function toRow(item: Record<string, unknown>): EventRow {
  return {
    algorithmId: item.AlgorithmId as string,
    runId: item.RunId as string,
    event: item.Event as string,
    timestamp: item.Timestamp as string,
    receivedAt: item.ReceivedAt as string,
    detail: item.Detail ?? null,
  };
}

// Exports one algorithm's timeline, optionally narrowed to a single run. Pages through every result so an
// export is never silently truncated; the SK gives a chronological (runId, timestamp) sort for free.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const algorithmId = event.pathParameters?.algorithmId;
  if (!algorithmId) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "missing algorithmId" }),
    };
  }
  const runId = event.queryStringParameters?.runId;
  const format = event.queryStringParameters?.format;

  const rows: EventRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: runId ? "AlgorithmId = :a AND begins_with(Sk, :s)" : "AlgorithmId = :a",
        ExpressionAttributeValues: runId ? { ":a": algorithmId, ":s": `${runId}#` } : { ":a": algorithmId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) {
      rows.push(toRow(item));
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  if (format === "csv") {
    return { statusCode: 200, headers: { "content-type": "text/csv" }, body: toCsv(rows) };
  }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(rows) };
};
