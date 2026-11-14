import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { type EventRow, toCsv } from "../lib/csv.js";

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
    auth: (item.Auth as string | undefined) ?? "none",
    origin: (item.Origin as string | undefined) ?? "service",
  };
}

// Exports the whole table across all algorithms. Pages through every scan page so a benchmarking export is
// never silently truncated.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const format = event.queryStringParameters?.format;

  const rows: EventRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: exclusiveStartKey }));
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
