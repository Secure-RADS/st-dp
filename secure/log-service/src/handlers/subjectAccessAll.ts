import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { scanAccesses } from "../lib/subjectAccessRows.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1_000;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Service-authority view: one page of access events plus an opaque cursor for the next page.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const parsed = Number(event.queryStringParameters?.limit ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const { rows, nextCursor } = await scanAccesses(ddb, table, limit, event.queryStringParameters?.cursor);
    return jsonResponse(200, { dataSubjectId: null, accesses: rows, nextCursor });
  } catch {
    return jsonResponse(400, { error: "invalid cursor" });
  }
};
