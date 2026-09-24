import { createCipheriv, randomBytes } from "node:crypto";
import { GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { loadDatasets, selectDatasets } from "./lib/datasets";
import { batch, documentClient, writeAll } from "./lib/dynamo";
import { requireEnv } from "./lib/env";

const table = requireEnv("PDM_TABLE");
const algorithmTable = requireEnv("ALGORITHM_TABLE");
const dataKeyTable = requireEnv("DATA_KEY_TABLE");

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const client = documentClient(region);
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

for (const ds of selectDatasets(loadDatasets())) {
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
      Item: { AlgorithmId: ds.algorithmId, DataKey: Buffer.from(encDek).toString("base64") },
    }),
  );

  const items = ds.records.map((r) => ({
    AlgorithmId: ds.algorithmId,
    RecordId: r.recordId,
    DataSubjectId: r.dataSubjectId,
    Data: encryptData(Buffer.from(dek), r.data),
  }));
  await writeAll(client, table, ds.name, batch(items));
}
console.log("done");
