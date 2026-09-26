import { createCipheriv, randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { createGzip } from "node:zlib";
import { GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { readDatasetMeta, resolveSeedNames, streamDatasetRecords } from "./lib/datasets";
import { toDynamoDbJsonLine } from "./lib/ddb-json";
import { documentClient } from "./lib/dynamo";
import { requireEnv } from "./lib/env";

const bucket = requireEnv("SEED_S3_BUCKET");
const prefix = process.env.SEED_S3_PREFIX ?? "pdm-import";
const tree = process.env.SEED_TREE ?? "rads";
const recordsPerPart = Math.max(1_000, Number(process.env.SEED_S3_PART_RECORDS ?? 200_000));
const region = process.env.AWS_REGION ?? "ap-southeast-2";

if (tree !== "rads" && tree !== "secure-rads") {
  console.error(`SEED_TREE must be rads or secure-rads, got ${tree}`);
  process.exit(1);
}

const s3 = new S3Client({ region });
const kms = new KMSClient({ region });
const ddb = documentClient(region);

function encryptData(dek: Buffer, data: unknown): Record<string, string> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: "1", nonce: nonce.toString("base64"), ct: Buffer.concat([ct, tag]).toString("base64") };
}

async function loadDek(algorithmId: string): Promise<Buffer> {
  const algorithmTable = requireEnv("ALGORITHM_TABLE");
  const dataKeyTable = requireEnv("DATA_KEY_TABLE");
  const algo = await ddb.send(new GetCommand({ TableName: algorithmTable, Key: { AlgorithmId: algorithmId } }));
  const kmsKeyArn = (algo.Item?.KmsKeyArn ?? "") as string;
  if (!kmsKeyArn) {
    throw new Error(`no KmsKeyArn for algorithm ${algorithmId}`);
  }
  const dk = await kms.send(new GenerateDataKeyCommand({ KeyId: kmsKeyArn, KeySpec: "AES_256" }));
  if (!dk.Plaintext || !dk.CiphertextBlob) {
    throw new Error(`GenerateDataKey returned no key for ${algorithmId}`);
  }
  await ddb.send(
    new PutCommand({
      TableName: dataKeyTable,
      Item: { AlgorithmId: algorithmId, DataKey: Buffer.from(dk.CiphertextBlob).toString("base64") },
    }),
  );
  return Buffer.from(dk.Plaintext);
}

type PartWriter = {
  index: number;
  key: string;
  gzip: ReturnType<typeof createGzip>;
  done: Promise<unknown>;
  count: number;
};

function openPart(dataset: string, index: number): PartWriter {
  const key = `${prefix}/${tree}/${dataset}/part-${String(index).padStart(4, "0")}.json.gz`;
  const gzip = createGzip();
  const body = new PassThrough();
  gzip.pipe(body);
  const done = new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: "application/gzip" },
  }).done();
  return { index, key, gzip, done, count: 0 };
}

async function closePart(part: PartWriter): Promise<void> {
  part.gzip.end();
  await part.done;
  console.log(`uploaded s3://${bucket}/${part.key} (${part.count} items)`);
}

for (const name of resolveSeedNames()) {
  const meta = await readDatasetMeta(name);
  const base = `${prefix}/${tree}/${meta.name}`;
  console.log(`${meta.name} (${meta.algorithmId}): uploading multipart s3://${bucket}/${base}/`);

  const dek = tree === "secure-rads" ? await loadDek(meta.algorithmId) : undefined;
  let part = openPart(meta.name, 0);
  let total = 0;

  for await (const record of streamDatasetRecords(name)) {
    if (part.count >= recordsPerPart) {
      await closePart(part);
      part = openPart(meta.name, part.index + 1);
    }
    const item: Record<string, unknown> = {
      AlgorithmId: meta.algorithmId,
      RecordId: record.recordId,
      DataSubjectId: record.dataSubjectId,
      Data: dek ? encryptData(dek, record.data) : record.data,
    };
    if (!part.gzip.write(`${toDynamoDbJsonLine(item)}\n`)) {
      await new Promise<void>((resolve) => part.gzip.once("drain", resolve));
    }
    part.count++;
    total++;
    if (total % 100_000 === 0) {
      console.log(`${meta.name}: staged ${total}${meta.expectedCount ? `/${meta.expectedCount}` : ""}`);
    }
  }
  await closePart(part);
  console.log(`${meta.name}: uploaded ${total} items across ${part.index + 1} parts`);
  console.log(`${meta.name}: import prefix s3://${bucket}/${base}/`);
}
console.log("done");
