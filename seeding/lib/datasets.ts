import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DatasetRecord {
  recordId: string;
  dataSubjectId?: string;
  data: Record<string, unknown>;
}

export interface DatasetFile {
  algorithmId: string;
  name: string;
  records: DatasetRecord[];
}

const DATASETS_DIR = join(import.meta.dir, "..", "datasets");

export function loadDatasets(): DatasetFile[] {
  const files = readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    console.error(`no dataset files in ${DATASETS_DIR}; run bun run generate first`);
    process.exit(1);
  }
  return files.map((f) => JSON.parse(readFileSync(join(DATASETS_DIR, f), "utf8")) as DatasetFile);
}
