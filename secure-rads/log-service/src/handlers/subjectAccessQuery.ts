import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { type SubjectAccessRow, toRow } from "../lib/subjectAccess.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const dataSubjectId = event.queryStringParameters?.dataSubjectId;

  const rows: SubjectAccessRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = dataSubjectId
      ? await ddb.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: "DataSubjectId = :s",
            ExpressionAttributeValues: { ":s": dataSubjectId },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        )
      : await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: exclusiveStartKey }));
    for (const item of result.Items ?? []) {
      rows.push(toRow(item));
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return jsonResponse(200, { dataSubjectId: dataSubjectId ?? null, accesses: rows });
};
