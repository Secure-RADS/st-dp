import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { toCsv } from "../lib/csv.js";
import { LOG_PARTITION, queryIndex } from "../lib/runLog.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

// Exports every algorithm's events in timestamp order via TimelineIndex, optionally narrowed to a
// ?from/?to ISO-8601 window. A scan would return the same items unordered and could not be range-limited.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const format = event.queryStringParameters?.format;
  const from = event.queryStringParameters?.from;
  const to = event.queryStringParameters?.to;

  const rows = await queryIndex(ddb, {
    table,
    indexName: "TimelineIndex",
    keyName: "LogPartition",
    keyValue: LOG_PARTITION,
    from,
    to,
  });

  if (format === "csv") {
    return { statusCode: 200, headers: { "content-type": "text/csv" }, body: toCsv(rows) };
  }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(rows) };
};
