import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { toCsv } from "../lib/csv.js";
import { queryIndex } from "../lib/runLog.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

// One run's timeline without knowing its algorithm. The base table is algorithm-keyed, so this was
// previously only reachable by scanning; RunIndex makes it a key query.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const runId = event.pathParameters?.runId;
  if (!runId) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "missing runId" }),
    };
  }
  const format = event.queryStringParameters?.format;

  const rows = await queryIndex(ddb, { table, indexName: "RunIndex", keyName: "RunIdKey", keyValue: runId });

  if (format === "csv") {
    return { statusCode: 200, headers: { "content-type": "text/csv" }, body: toCsv(rows) };
  }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(rows) };
};
