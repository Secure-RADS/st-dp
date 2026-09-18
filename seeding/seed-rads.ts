import { loadDatasets } from "./lib/datasets";
import { batch, documentClient, writeAll } from "./lib/dynamo";
import { requireEnv } from "./lib/env";

const table = requireEnv("RADS_PDM_TABLE");

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const client = documentClient(region);

// The rads PDM is open: records are stored as raw JSON, no envelope encryption or KMS involved.
for (const ds of loadDatasets()) {
  console.log(`${ds.name} (${ds.algorithmId}): seeding ${ds.records.length} records`);
  const items = ds.records.map((r) => ({
    AlgorithmId: ds.algorithmId,
    RecordId: r.recordId,
    Data: r.data,
  }));
  await writeAll(client, table, ds.name, batch(items));
}
console.log("done");
