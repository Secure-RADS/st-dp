import { createCipheriv, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import pMap from "p-map";

const DATASETS_DIR = join(import.meta.dir, "datasets");
const BATCH_SIZE = 25;
const MAX_RETRIES = 8;
// Keep pressure low because every dataset writes to one partition key; throttled requests are retried below.
const CONCURRENCY = 5;

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
const algorithmTable = process.env.ALGORITHM_TABLE;
if (!algorithmTable) {
  console.error("ALGORITHM_TABLE environment variable is not set");
  process.exit(1);
}
const dataKeyTable = process.env.DATA_KEY_TABLE;
if (!dataKeyTable) {
  console.error("DATA_KEY_TABLE environment variable is not set");
  process.exit(1);
}

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const kms = new KMSClient({ region });

// Encrypt a record's data under a per-algorithm data key (AES-256-GCM). The plaintext is never stored;
// pdm-service only ever sees this {v,nonce,ct} ciphertext blob.
function encryptData(dek: Buffer, data: unknown): Record<string, string> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: "1", nonce: nonce.toString("base64"), ct: Buffer.concat([ct, tag]).toString("base64") };
}

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
    try {
      const out = await client.send(new BatchWriteCommand({ RequestItems: { [table as string]: requests } }));
      requests = (out.UnprocessedItems?.[table as string] ?? []) as typeof requests;
    } catch (error) {
      if (error instanceof Error && error.name === "ThrottlingException") continue;
      throw error;
    }
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

  // registry-service stored the PCR-bound KMS key ARN in the AlgorithmTable at build time; seeding must
  // run after the build for that key to exist. Without it there's no way to envelope the records.
  const algo = await client.send(new GetCommand({ TableName: algorithmTable, Key: { AlgorithmId: ds.algorithmId } }));
  const kmsKeyArn = (algo.Item?.KmsKeyArn ?? "") as string;
  if (!kmsKeyArn) {
    throw new Error(`${ds.name}: no KMS key for algorithm ${ds.algorithmId}; build it first`);
  }

  const dk = await kms.send(new GenerateDataKeyCommand({ KeyId: kmsKeyArn, KeySpec: "AES_256" }));
  const dek = dk.Plaintext;
  const encDek = dk.CiphertextBlob;
  if (!dek || !encDek) {
    throw new Error(`${ds.name}: GenerateDataKey returned no key`);
  }

  await client.send(
    new PutCommand({
      TableName: dataKeyTable,
      Item: {
        AlgorithmId: ds.algorithmId,
        DataKey: Buffer.from(encDek).toString("base64"),
      },
    }),
  );

  const batches: Record<string, unknown>[][] = [];
  for (let i = 0; i < ds.records.length; i += BATCH_SIZE) {
    batches.push(
      ds.records.slice(i, i + BATCH_SIZE).map((r) => ({
        AlgorithmId: ds.algorithmId,
        RecordId: r.recordId,
        Data: encryptData(Buffer.from(dek), r.data),
      })),
    );
  }

  let written = 0;
  let nextLog = 1000;
  await pMap(
    batches,
    async (batch) => {
      await writeBatch(batch);
      written += batch.length;
      if (written >= nextLog || written === ds.records.length) {
        console.log(`${ds.name}: ${written}/${ds.records.length}`);
        nextLog = written + 1000;
      }
    },
    { concurrency: CONCURRENCY },
  );
}
console.log("done");
