import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { scanAccesses } from "../lib/subjectAccessRows.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");
const DEFAULT_LIMIT = 5_000;
const MAX_LIMIT = 20_000;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Service-authority view: a bounded window over every subject-access event. The table can hold tens of
// millions of rows, so a full scan cannot finish inside the Lambda timeout; the response says when it was cut.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const parsed = Number(event.queryStringParameters?.limit ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;

  const { rows, truncated } = await scanAccesses(ddb, table, limit);
  return jsonResponse(200, { dataSubjectId: null, accesses: rows, truncated });
};
