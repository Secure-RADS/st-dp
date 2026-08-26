import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const DATASETS_DIR = join(import.meta.dir, "datasets");
const BATCH_SIZE = 25;
const MAX_RETRIES = 8;

interface DatasetFile {
  algorithmId: string;
  name: string;
  records: { recordId: string; data: Record<string, unknown> }[];
}

const table = process.env.PDM_TABLE;
if (!table) {
  console.error("PDM_TABLE environment variable is not set");
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-south-1" }));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBatch(items: Record<string, unknown>[]): Promise<void> {
  let requests = items.map((item) => ({ PutRequest: { Item: item } }));
  for (let attempt = 0; requests.length > 0; attempt++) {
    if (attempt > MAX_RETRIES) {
      throw new Error(`giving up after ${MAX_RETRIES} retries with ${requests.length} unprocessed items`);
    }
    if (attempt > 0) {
      await sleep(100 * 2 ** attempt);
    }
    const out = await client.send(new BatchWriteCommand({ RequestItems: { [table as string]: requests } }));
    requests = (out.UnprocessedItems?.[table as string] ?? []) as typeof requests;
  }
}

const files = readdirSync(DATASETS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
if (files.length === 0) {
  console.error(`no dataset files in ${DATASETS_DIR}; run bun run generate first`);
  process.exit(1);
}

for (const file of files) {
  const ds: DatasetFile = JSON.parse(readFileSync(join(DATASETS_DIR, file), "utf8"));
  console.log(`${ds.name} (${ds.algorithmId}): seeding ${ds.records.length} records`);
  let written = 0;
  for (let i = 0; i < ds.records.length; i += BATCH_SIZE) {
    const batch = ds.records.slice(i, i + BATCH_SIZE).map((r) => ({
      AlgorithmId: ds.algorithmId,
      RecordId: r.recordId,
      Data: r.data,
    }));
    await writeBatch(batch);
    written += batch.length;
    if (written % 1000 === 0 || written === ds.records.length) {
      console.log(`${ds.name}: ${written}/${ds.records.length}`);
    }
  }
}
console.log("done");
