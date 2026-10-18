import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { type CostRow, csvHeaders, toCsv } from "../lib/csv.js";
import { decodeCursor, encodeCursor, PAGE_SIZE } from "../lib/cursor.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("COST_TABLE");

function toRow(item: Record<string, unknown>): CostRow {
  return {
    algorithmId: item.AlgorithmId as string,
    runId: item.RunId as string,
    phase: item.Phase as string,
    service: item.Service as string,
    operation: item.Operation as string,
    quantity: item.Quantity as number,
    unit: item.Unit as string,
    costUsd: item.CostUsd as number,
    timestamp: item.Timestamp as string,
    receivedAt: item.ReceivedAt as string,
    detail: item.Detail ?? null,
  };
}

// Cursor paging keeps full-table exports below API Gateway's response-size limit.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const format = event.queryStringParameters?.format;

  let exclusiveStartKey: Record<string, unknown> | undefined;
  const cursor = event.queryStringParameters?.cursor;
  if (cursor) {
    exclusiveStartKey = decodeCursor(cursor);
    if (!exclusiveStartKey) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "invalid cursor" }),
      };
    }
  }

  const result = await ddb.send(
    new ScanCommand({ TableName: table, Limit: PAGE_SIZE, ExclusiveStartKey: exclusiveStartKey }),
  );
  const rows = (result.Items ?? []).map(toRow);
  const nextCursor = result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null;

  if (format === "csv") {
    return { statusCode: 200, headers: csvHeaders(nextCursor), body: toCsv(rows) };
  }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: rows, nextCursor }),
  };
};
