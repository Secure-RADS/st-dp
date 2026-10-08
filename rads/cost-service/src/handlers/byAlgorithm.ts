import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { type CostRow, toCsv } from "../lib/csv.js";
import { requiredEnv } from "../lib/env.js";
import { PRICE_AS_OF, PRICE_REGION } from "../lib/prices.js";

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

// Exports one algorithm's cost events, optionally narrowed to a single run, and sums the run total in the
// response so callers do not have to re-add the per-operation lines. Pages through every result.
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

  const rows: CostRow[] = [];
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

  const totalUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      algorithmId,
      runId: runId ?? null,
      priceRegion: PRICE_REGION,
      priceAsOf: PRICE_AS_OF,
      totalUsd,
      events: rows,
    }),
  };
};
