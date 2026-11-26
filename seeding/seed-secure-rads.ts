import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CreateKeyCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readDatasetMeta, resolveSeedNames, streamDatasetRecords } from "./lib/datasets";
import { documentClient, dynamoClient, writeAll } from "./lib/dynamo";
import { requireEnv } from "./lib/env";
import { ensurePdmTable, pdmTableName, tableExists } from "./lib/tables";

const tablePrefix = requireEnv("PDM_TABLE_PREFIX");
const algorithmTable = requireEnv("ALGORITHM_TABLE");
const dataKeyTable = requireEnv("DATA_KEY_TABLE");
const BATCH_SIZE = 25;
const flushEvery = Math.max(25, Number(process.env.SEED_FLUSH_BATCHES ?? 400));
const pipelineDepth = Math.max(1, Number(process.env.SEED_PIPELINE ?? 2));
const skip = Math.max(0, Number(process.env.SEED_SKIP ?? 0));
const forceNewKey = process.env.SEED_FORCE_NEW_KEY === "1";

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const client = documentClient(region);
const tables = dynamoClient(region);
const kms = new KMSClient({ region });

function dekCachePath(algorithmId: string): string {
  return `/tmp/sce-seed-dek-${algorithmId}.bin`;
}

function encryptData(dek: Buffer, data: unknown): Record<string, string> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: "1", nonce: nonce.toString("base64"), ct: Buffer.concat([ct, tag]).toString("base64") };
}

async function loadOrCreateDek(algorithmId: string, kmsKeyArn: string): Promise<Buffer> {
  const cache = dekCachePath(algorithmId);
  if (!forceNewKey && existsSync(cache)) {
    const dek = readFileSync(cache);
    if (dek.length === 32) return dek;
  }

  const dk = await kms.send(new GenerateDataKeyCommand({ KeyId: kmsKeyArn, KeySpec: "AES_256" }));
  if (!dk.Plaintext || !dk.CiphertextBlob) {
    throw new Error(`GenerateDataKey returned no key for algorithm ${algorithmId}`);
  }
  await client.send(
    new PutCommand({
      TableName: dataKeyTable,
      Item: { AlgorithmId: algorithmId, DataKey: Buffer.from(dk.CiphertextBlob).toString("base64") },
    }),
  );
  const dek = Buffer.from(dk.Plaintext);
  writeFileSync(cache, dek);
  return dek;
}

async function loadOrCreateTableKey(algorithmId: string, existingKeyArn: string | undefined): Promise<string> {
  if (existingKeyArn) return existingKeyArn;

  const created = await kms.send(
    new CreateKeyCommand({
      Description: `dynamodb table key for algorithm ${algorithmId}`,
      KeyUsage: "ENCRYPT_DECRYPT",
      KeySpec: "SYMMETRIC_DEFAULT",
    }),
  );
  const keyArn = created.KeyMetadata?.Arn;
  if (!keyArn) {
    throw new Error(`CreateKey returned no key for algorithm ${algorithmId}`);
  }
  await client.send(
    new UpdateCommand({
      TableName: algorithmTable,
      Key: { AlgorithmId: algorithmId },
      UpdateExpression: "SET PdmTableKeyArn = :k",
      ExpressionAttributeValues: { ":k": keyArn },
    }),
  );
  return keyArn;
}

for (const name of resolveSeedNames()) {
  const meta = await readDatasetMeta(name);
  const table = pdmTableName(tablePrefix, meta.algorithmId);
  const progress = { written: skip, total: meta.expectedCount };
  console.log(
    `${meta.name} (${meta.algorithmId}): seeding${meta.expectedCount ? ` ${meta.expectedCount}` : ""} records` +
      (skip > 0 ? ` (skip ${skip})` : ""),
  );

  const algo = await client.send(new GetCommand({ TableName: algorithmTable, Key: { AlgorithmId: meta.algorithmId } }));
  const kmsKeyArn = (algo.Item?.KmsKeyArn ?? "") as string;
  if (!kmsKeyArn) {
    throw new Error(`${meta.name}: no KMS key for algorithm ${meta.algorithmId}; build it first`);
  }

  if (!(await tableExists(tables, table))) {
    const tableKeyArn = await loadOrCreateTableKey(meta.algorithmId, algo.Item?.PdmTableKeyArn as string | undefined);
    await ensurePdmTable(tables, table, tableKeyArn);
  }

  const dekBuf = await loadOrCreateDek(meta.algorithmId, kmsKeyArn);
  let seen = 0;
  let batch: Record<string, unknown>[] = [];
  let batches: Record<string, unknown>[][] = [];
  const inflight: Promise<void>[] = [];

  const enqueue = async (chunk: Record<string, unknown>[][]) => {
    const written = await writeAll(client, table, meta.name, chunk);
    progress.written += written;
    console.log(`${meta.name}: ${progress.written}/${progress.total ?? "?"}`);
  };

  for await (const record of streamDatasetRecords(name)) {
    seen++;
    if (seen <= skip) continue;

    batch.push({
      AlgorithmId: meta.algorithmId,
      RecordId: record.recordId,
      DataSubjectId: record.dataSubjectId,
      Data: encryptData(dekBuf, record.data),
    });
    if (batch.length >= BATCH_SIZE) {
      batches.push(batch);
      batch = [];
    }
    if (batches.length >= flushEvery) {
      const chunk = batches;
      batches = [];
      inflight.push(enqueue(chunk));
      if (inflight.length >= pipelineDepth) {
        await inflight.shift();
      }
    }
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  if (batches.length > 0) {
    inflight.push(enqueue(batches));
  }
  await Promise.all(inflight);
  console.log(`${meta.name}: finished ${progress.written} records`);
}
console.log("done");
