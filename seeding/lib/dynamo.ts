import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import pMap from "p-map";

const BATCH_SIZE = 25;
const MAX_RETRIES = 8;
// Every dataset writes to one partition key, so keep concurrency low; throttled requests are retried below.
const CONCURRENCY = 5;

export function documentClient(region: string): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
}

export function batch(items: Record<string, unknown>[]): Record<string, unknown>[][] {
  const batches: Record<string, unknown>[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

export async function writeAll(
  client: DynamoDBDocumentClient,
  table: string,
  name: string,
  batches: Record<string, unknown>[][],
): Promise<void> {
  const total = batches.reduce((n, b) => n + b.length, 0);
  let written = 0;
  let nextLog = 1000;
  await pMap(
    batches,
    async (items) => {
      await writeBatch(client, table, items);
      written += items.length;
      if (written >= nextLog || written === total) {
        console.log(`${name}: ${written}/${total}`);
        nextLog = written + 1000;
      }
    },
    { concurrency: CONCURRENCY },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBatch(
  client: DynamoDBDocumentClient,
  table: string,
  items: Record<string, unknown>[],
): Promise<void> {
  let requests = items.map((item) => ({ PutRequest: { Item: item } }));
  for (let attempt = 0; requests.length > 0; attempt++) {
    if (attempt > MAX_RETRIES) {
      throw new Error(`giving up after ${MAX_RETRIES} retries with ${requests.length} unprocessed items`);
    }
    if (attempt > 0) {
      await sleep(100 * 2 ** attempt);
    }
    try {
      const out = await client.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
      requests = (out.UnprocessedItems?.[table] ?? []) as typeof requests;
    } catch (error) {
      if (error instanceof Error && error.name === "ThrottlingException") continue;
      throw error;
    }
  }
}
