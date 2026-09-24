import { EHEALTH_ALGORITHM_ID } from "./config";
import { deleteAllForAlgorithm, documentClient } from "./lib/dynamo";
import { requireEnv } from "./lib/env";

// Clear the sweep algorithm's records in both PDMs. The size sweep reuses one algorithmId, so leftover
// records from a previous (larger) size would otherwise contaminate the next run's dataset.
const region = process.env.AWS_REGION ?? "ap-southeast-2";
const client = documentClient(region);

for (const name of ["RADS_PDM_TABLE", "PDM_TABLE"]) {
  const table = requireEnv(name);
  const deleted = await deleteAllForAlgorithm(client, table, EHEALTH_ALGORITHM_ID);
  console.log(`${table}: cleared ${deleted} records for ${EHEALTH_ALGORITHM_ID}`);
}
