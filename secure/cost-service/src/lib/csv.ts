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

// CSV can't carry a cursor in the body, so the next-page token rides on a response header for clients that page.
export function csvHeaders(nextCursor: string | null): Record<string, string> {
  return nextCursor ? { "content-type": "text/csv", "x-next-cursor": nextCursor } : { "content-type": "text/csv" };
}

export function toCsv(rows: CostRow[]): string {
  // Serialize detail objects as JSON so csv-stringify emits one cell instead of [object Object].
  return stringify(
    rows.map((row) => ({ ...row, detail: row.detail == null ? "" : JSON.stringify(row.detail) })),
    { header: true, columns: COLUMNS },
  );
}
