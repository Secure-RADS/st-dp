import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { retryAsync } from "ts-retry";
import { type SubjectAccessIngest, toItem } from "./subjectAccess.js";

// DynamoDB BatchWriteItem accepts at most 25 items per request, so oversized batches are chunked.
const CHUNK = 25;
const MAX_TRY = 4;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Retries only when DynamoDB throttles (partial writes surface as UnprocessedItems, not a rejection). The
// item key is derived entirely from the payload, so re-sending a chunk overwrites with identical data.
async function writeItems(ddb: DynamoDBDocumentClient, table: string, items: Record<string, unknown>[]): Promise<void> {
  await retryAsync(
    async () => {
      const out = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: items } }));
      const unprocessed = out.UnprocessedItems?.[table] ?? [];
      if (unprocessed.length > 0) {
        throw new Error(`${unprocessed.length} unprocessed subject-access items`);
      }
    },
    { maxTry: MAX_TRY },
  );
}

export async function persistSubjectAccess(
  ddb: DynamoDBDocumentClient,
  table: string,
  ingest: SubjectAccessIngest,
): Promise<void> {
  const items = [...new Set(ingest.dataSubjectIds)].map((dataSubjectId) => ({
    PutRequest: {
      Item: toItem({
        dataSubjectId,
        algorithmId: ingest.algorithmId,
        runId: ingest.runId,
        timestamp: ingest.timestamp,
        receivedAt: ingest.receivedAt,
      }),
    },
  }));
  await Promise.all(chunk(items, CHUNK).map((batch) => writeItems(ddb, table, batch)));
}
