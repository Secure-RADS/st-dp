import { readDatasetMeta, resolveSeedNames, streamDatasetRecords } from "./lib/datasets";
import { documentClient, dynamoClient, writeAll } from "./lib/dynamo";
import { requireEnv } from "./lib/env";
import { ensurePdmTable, pdmTableName } from "./lib/tables";

const tablePrefix = requireEnv("PDM_TABLE_PREFIX");
const BATCH_SIZE = 25;
const flushEvery = Math.max(25, Number(process.env.SEED_FLUSH_BATCHES ?? 400));
const pipelineDepth = Math.max(1, Number(process.env.SEED_PIPELINE ?? 2));
const skip = Math.max(0, Number(process.env.SEED_SKIP ?? 0));

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const client = documentClient(region);
const tables = dynamoClient(region);

for (const name of resolveSeedNames()) {
  const meta = await readDatasetMeta(name);
  const table = pdmTableName(tablePrefix, meta.algorithmId);
  await ensurePdmTable(tables, table);
  const progress = { written: skip, total: meta.expectedCount };
  console.log(
    `${meta.name} (${meta.algorithmId}): seeding${meta.expectedCount ? ` ${meta.expectedCount}` : ""} records` +
      (skip > 0 ? ` (skip ${skip})` : ""),
  );

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
      Data: record.data,
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
