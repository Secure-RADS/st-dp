import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { type SubjectAccessRow, toRow } from "./subjectAccess.js";

export async function queryAccesses(
  ddb: DynamoDBDocumentClient,
  table: string,
  dataSubjectId: string,
): Promise<SubjectAccessRow[]> {
  const rows: SubjectAccessRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "DataSubjectId = :s",
        ExpressionAttributeValues: { ":s": dataSubjectId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) rows.push(toRow(item));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}

export async function scanAllAccesses(ddb: DynamoDBDocumentClient, table: string): Promise<SubjectAccessRow[]> {
  const rows: SubjectAccessRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: exclusiveStartKey }));
    for (const item of result.Items ?? []) rows.push(toRow(item));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}
