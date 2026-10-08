import { stringify } from "csv-stringify/sync";

export interface CostRow {
  algorithmId: string;
  runId: string;
  phase: string;
  service: string;
  operation: string;
  quantity: number;
  unit: string;
  costUsd: number;
  timestamp: string;
  receivedAt: string;
  detail: unknown;
}

const COLUMNS = [
  "algorithmId",
  "runId",
  "phase",
  "service",
  "operation",
  "quantity",
  "unit",
  "costUsd",
  "timestamp",
  "receivedAt",
  "detail",
];

export function toCsv(rows: CostRow[]): string {
  // detail is an object; flatten it to compact JSON so csv-stringify emits one cell, not [object Object].
  return stringify(
    rows.map((row) => ({ ...row, detail: row.detail == null ? "" : JSON.stringify(row.detail) })),
    { header: true, columns: COLUMNS },
  );
}
