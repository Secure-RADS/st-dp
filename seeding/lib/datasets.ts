import { createReadStream, existsSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { DEFAULT_SEED_NAMES, EHEALTH_SIZES } from "../config";

export interface DatasetRecord {
  recordId: string;
  dataSubjectId?: string;
  data: Record<string, unknown>;
}

export interface DatasetMeta {
  algorithmId: string;
  name: string;
  path: string;
  expectedCount: number | null;
}

const DATASETS_DIR = join(import.meta.dir, "..", "datasets");

const EHEALTH_COUNT = new Map(EHEALTH_SIZES.map((count) => [`ehealth-${count / 1000}k`, count]));

function datasetPath(name: string): string {
  return join(DATASETS_DIR, `${name}.json`);
}

export function resolveSeedNames(): string[] {
  const only = process.env.SEED_DATASET;
  if (only) {
    if (!existsSync(datasetPath(only))) {
      console.error(`SEED_DATASET=${only} matched no dataset; run bun run generate first`);
      process.exit(1);
    }
    return [only];
  }

  const defaults = new Set(DEFAULT_SEED_NAMES);
  const names = readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((name) => defaults.has(name))
    .sort();
  if (names.length === 0) {
    console.error(`no dataset files in ${DATASETS_DIR}; run bun run generate first`);
    process.exit(1);
  }
  return names;
}

export async function readDatasetMeta(name: string): Promise<DatasetMeta> {
  const path = datasetPath(name);
  if (!existsSync(path)) {
    throw new Error(`dataset ${name} not found at ${path}`);
  }
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const match = line.match(/"algorithmId"\s*:\s*"([^"]+)"\s*,\s*"name"\s*:\s*"([^"]+)"/);
    rl.close();
    if (!match) {
      throw new Error(`dataset ${name}: could not parse header line`);
    }
    return {
      algorithmId: match[1]!,
      name: match[2]!,
      path,
      expectedCount: EHEALTH_COUNT.get(name) ?? null,
    };
  }
  throw new Error(`dataset ${name}: empty file`);
}

// Records are one JSON object per line (see generate.ts); stream them so multi-GB files do not need to fit in RAM.
export async function* streamDatasetRecords(name: string): AsyncGenerator<DatasetRecord> {
  const path = datasetPath(name);
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let header = true;
  for await (const raw of rl) {
    if (header) {
      header = false;
      continue;
    }
    let line = raw.trim();
    if (!line || line === "]}" || line === "]") {
      continue;
    }
    if (line.endsWith(",")) {
      line = line.slice(0, -1);
    }
    yield JSON.parse(line) as DatasetRecord;
  }
}
