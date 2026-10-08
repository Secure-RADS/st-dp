import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { type CostRow, toCsv } from "../lib/csv.js";
import { requiredEnv } from "../lib/env.js";

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

// Exports the whole table across all algorithms as flat rows. Pages through every scan page.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const format = event.queryStringParameters?.format;

  const rows: CostRow[] = [];
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
