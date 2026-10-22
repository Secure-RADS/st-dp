import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { EventRow } from "./csv.js";

// Constant partition key for TimelineIndex, so a cross-algorithm export is a chronological query
// instead of a scan that has to be sorted in the Lambda.
export const LOG_PARTITION = "EVENT";

export function toRow(item: Record<string, unknown>): EventRow {
  return {
    algorithmId: item.AlgorithmId as string,
    runId: item.RunId as string,
    event: item.Event as string,
    timestamp: item.Timestamp as string,
    receivedAt: item.ReceivedAt as string,
    detail: item.Detail ?? null,
  };
}

export interface IndexQuery {
  table: string;
  indexName: string;
  keyName: string;
  keyValue: string;
  from?: string;
  to?: string;
}

function keyCondition(keyName: string, from?: string, to?: string): string {
  if (from && to) return `${keyName} = :k AND #ts BETWEEN :from AND :to`;
  if (from) return `${keyName} = :k AND #ts >= :from`;
  if (to) return `${keyName} = :k AND #ts <= :to`;
  return `${keyName} = :k`;
}

// Pages through every result so an export is never silently truncated. Timestamp is a reserved-ish
// attribute name in expressions, hence the #ts alias.
export async function queryIndex(ddb: DynamoDBDocumentClient, query: IndexQuery): Promise<EventRow[]> {
  const { table, indexName, keyName, keyValue, from, to } = query;
  const rows: EventRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: indexName,
        KeyConditionExpression: keyCondition(keyName, from, to),
        ExpressionAttributeNames: from || to ? { "#ts": "Timestamp" } : undefined,
        ExpressionAttributeValues: {
          ":k": keyValue,
          ...(from ? { ":from": from } : {}),
          ...(to ? { ":to": to } : {}),
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) rows.push(toRow(item));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}
