#!/usr/bin/env bun

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REGION = "ap-southeast-2";
const HERE = import.meta.dir;
const RAW_DIR = join(HERE, "results", "raw");
const OUT_CSV = join(HERE, "results", "sweep.csv");

const LOG_STACKS: Record<string, string> = {
  rads: "rads-log-service-dev",
  "secure-rads": "secure-rads-log-service-dev",
};

// null endpoints = phase does not apply (rads has no enclave).
type Window = [start: string | null, end: string | null];

const PHASES: Record<string, Record<string, Window>> = {
  "secure-rads": {
    algorithm_retrieval: ["executor-ready", "artifact-retrieved"],
    enclave_initialization: ["enclave-launched", "enclave-started"],
    attestation: ["unit-ready", "attested"],
    sce_unit: ["enclave-started", "unit-ready"],
    data_retrieval: ["attested", "records-fetched"],
    data_decryption: ["records-fetched", "data-decrypted"],
    algorithm_processing: ["data-decrypted", "dc-app-completed"],
    result_delivery: ["output-sent", "result-persisted"],
    total: ["run-requested", "result-persisted"],
  },
  rads: {
    algorithm_retrieval: ["executor-ready", "artifact-retrieved"],
    enclave_initialization: ["executor-launched", "executor-ready"],
    attestation: [null, null],
    sce_unit: [null, null],
    data_retrieval: ["artifact-retrieved", "records-fetched"],
    data_decryption: [null, null],
    algorithm_processing: ["records-fetched", "compute-completed"],
    result_delivery: ["compute-completed", "executor-finished"],
    total: ["run-requested", "executor-finished"],
  },
};

const COLUMNS = Object.keys(PHASES["secure-rads"]);

const TIMESTAMP_EVENTS = [
  "run-requested",
  "executor-launched",
  "enclave-launched",
  "executor-ready",
  "artifact-retrieved",
  "enclave-started",
  "unit-ready",
  "attested",
  "records-fetched",
  "data-decrypted",
  "dc-app-completed",
  "compute-completed",
  "output-sent",
  "result-persisted",
  "executor-finished",
];

interface RawRow {
  tree: string;
  size: number | null;
  rep: number;
  run_id: string | null;
  algorithm_id: string;
  status: string | null;
}

function aws(args: string[]): string {
  const proc = Bun.spawnSync(["aws", ...args]);
  if (proc.exitCode !== 0) {
    throw new Error(`aws ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

function logUrl(stack: string): string {
  return aws([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stack,
    "--region",
    REGION,
    "--query",
    "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue",
    "--output",
    "text",
  ]);
}

function loadRuns(): RawRow[] {
  const rows: RawRow[] = [];
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.startsWith("sweep-") && f.endsWith(".json"))
    .sort();
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(RAW_DIR, file), "utf8")) as RawRow[];
    rows.push(...parsed.filter((row) => row.run_id && row.size !== null));
  }
  return rows;
}

async function fetchEvents(url: string, algorithmId: string, runId: string): Promise<Map<string, string>> {
  const res = await fetch(`${url}/logs/${algorithmId}?runId=${runId}`);
  if (!res.ok) {
    throw new Error(`GET ${url}/logs/${algorithmId}?runId=${runId} returned ${res.status}`);
  }
  const events = (await res.json()) as { event: string; timestamp: string }[];
  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const byEvent = new Map<string, string>();
  for (const event of events) {
    if (!byEvent.has(event.event)) {
      byEvent.set(event.event, event.timestamp);
    }
  }
  return byEvent;
}

function windowSeconds(byEvent: Map<string, string>, window: Window): string {
  const [start, end] = window;
  if (!start || !end) {
    return "";
  }
  const from = byEvent.get(start);
  const to = byEvent.get(end);
  if (!from || !to) {
    return "";
  }
  return ((Date.parse(to) - Date.parse(from)) / 1000).toFixed(2);
}

async function main(): Promise<void> {
  const runs = loadRuns();
  if (runs.length === 0) {
    console.error(`no sweep rows in ${RAW_DIR}; run benchmark/run.py --sweep first`);
    process.exit(1);
  }
  const urls: Record<string, string> = {
    rads: logUrl(LOG_STACKS.rads),
    "secure-rads": logUrl(LOG_STACKS["secure-rads"]),
  };

  const header = [
    "dataset_size",
    "tree",
    "run",
    "status",
    ...COLUMNS.map((column) => `${column}_s`),
    ...TIMESTAMP_EVENTS.map((event) => `${event}_ts`),
  ];
  const lines = [header.join(",")];

  for (const row of runs) {
    const byEvent = await fetchEvents(urls[row.tree], row.algorithm_id, row.run_id as string);
    const phases = COLUMNS.map((column) => windowSeconds(byEvent, PHASES[row.tree][column]));
    const stamps = TIMESTAMP_EVENTS.map((event) => byEvent.get(event) ?? "");
    lines.push([String(row.size), row.tree, String(row.rep), row.status ?? "", ...phases, ...stamps].join(","));
  }

  writeFileSync(OUT_CSV, `${lines.join("\n")}\n`);
  console.log(`wrote ${OUT_CSV} (${runs.length} runs)`);
}

await main();
