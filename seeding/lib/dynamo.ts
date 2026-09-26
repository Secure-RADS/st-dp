import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import pMap from "p-map";

const BATCH_SIZE = 25;
const MAX_RETRIES = 16;
const CONCURRENCY = Math.max(1, Number(process.env.SEED_WRITE_CONCURRENCY ?? 40));

export function documentClient(region: string): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      maxAttempts: 3,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
        throwOnRequestTimeout: true,
        socketTimeout: 30_000,
      }),
    }),
  );
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
  _name: string,
  batches: Record<string, unknown>[][],
): Promise<number> {
  const counts = await pMap(
    batches,
    async (items) => {
      await writeBatch(client, table, items);
      return items.length;
    },
    { concurrency: CONCURRENCY },
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ThrottlingException" ||
    error.name === "ProvisionedThroughputExceededException" ||
    error.name === "RequestLimitExceeded" ||
    error.name === "TimeoutError" ||
    /throughput|throttl|timeout/i.test(error.message)
  );
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
      await sleep(Math.min(2000, 40 * 2 ** attempt));
    }
    try {
      const out = await client.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
      requests = (out.UnprocessedItems?.[table] ?? []) as typeof requests;
    } catch (error) {
      if (isRetryable(error)) continue;
      throw error;
    }
  }
}
