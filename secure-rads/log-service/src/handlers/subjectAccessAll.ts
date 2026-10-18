import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { scanAllAccesses } from "../lib/subjectAccessRows.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Service-authority view: stream every subject-access event, not scoped to one data subject.
export const handler: APIGatewayProxyHandlerV2 = async () => {
  const accesses = await scanAllAccesses(ddb, table);
  return jsonResponse(200, { dataSubjectId: null, accesses });
};
