import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { queryAccessesByAlgorithm } from "../lib/subjectAccessRows.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Controller/authority view: which data subjects one algorithm touched. The table is DS-keyed, so this
// direction is only a key query through AlgorithmIndex.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const algorithmId = event.pathParameters?.algorithmId;
  if (!algorithmId) return jsonResponse(400, { error: "missing algorithmId" });

  const accesses = await queryAccessesByAlgorithm(ddb, table, algorithmId);
  return jsonResponse(200, { algorithmId, accesses });
};
