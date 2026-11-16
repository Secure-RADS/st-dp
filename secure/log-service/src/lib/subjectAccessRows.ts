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

export interface AccessScan {
  rows: SubjectAccessRow[];
  truncated: boolean;
}

// The access table is not bounded: benchmark sweeps leave millions of rows, so a full scan cannot finish
// inside a Lambda timeout. Return a bounded newest-ish window instead and tell the caller it was truncated.
export async function scanAccesses(ddb: DynamoDBDocumentClient, table: string, limit: number): Promise<AccessScan> {
  const rows: SubjectAccessRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const pageSize = Math.min(1000, limit - rows.length);
    const result = await ddb.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: exclusiveStartKey, Limit: pageSize }),
    );
    for (const item of result.Items ?? []) rows.push(toRow(item));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey && rows.length < limit);
  return { rows, truncated: Boolean(exclusiveStartKey) };
}
