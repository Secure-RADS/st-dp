import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { queryAccesses } from "../lib/subjectAccessRows.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Data-subject view: a single subject's access trail, queried by their UUID (the PDM DSAR proxy relays here).
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const dataSubjectId = event.pathParameters?.dataSubjectId;
  if (!dataSubjectId) return jsonResponse(400, { error: "missing dataSubjectId" });

  const accesses = await queryAccesses(ddb, table, dataSubjectId);
  return jsonResponse(200, { dataSubjectId, accesses });
};
