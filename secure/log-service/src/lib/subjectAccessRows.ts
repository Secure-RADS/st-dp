import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { paginateQuery, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { type SubjectAccessRow, toRow } from "./subjectAccess.js";

export async function queryAccesses(
  ddb: DynamoDBDocumentClient,
  table: string,
  dataSubjectId: string,
): Promise<SubjectAccessRow[]> {
  const rows: SubjectAccessRow[] = [];
  const pages = paginateQuery(
    { client: ddb },
    {
      TableName: table,
      KeyConditionExpression: "DataSubjectId = :s",
      ExpressionAttributeValues: { ":s": dataSubjectId },
    },
  );
  for await (const page of pages) {
    for (const item of page.Items ?? []) rows.push(toRow(item));
  }
  return rows;
}

export interface AccessPage {
  rows: SubjectAccessRow[];
  nextCursor: string | null;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

function decodeCursor(cursor: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("cursor must encode an object");
  }
  return parsed as Record<string, unknown>;
}

// The access table can hold tens of millions of rows, so a single Lambda cannot scan it. Return one page
// and an opaque cursor for the next; the caller pages until nextCursor is null.
export async function scanAccesses(
  ddb: DynamoDBDocumentClient,
  table: string,
  limit: number,
  cursor?: string,
): Promise<AccessPage> {
  const result = await ddb.send(
    new ScanCommand({
      TableName: table,
      Limit: limit,
      ExclusiveStartKey: cursor ? decodeCursor(cursor) : undefined,
    }),
  );
  return {
    rows: (result.Items ?? []).map(toRow),
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null,
  };
}
