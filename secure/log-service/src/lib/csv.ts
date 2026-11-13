import { stringify } from "csv-stringify/sync";

export interface EventRow {
  algorithmId: string;
  runId: string;
  event: string;
  timestamp: string;
  receivedAt: string;
  detail: unknown;
}

const COLUMNS = ["algorithmId", "runId", "event", "timestamp", "receivedAt", "detail"];

export function toCsv(rows: EventRow[]): string {
  // detail is an object; flatten it to compact JSON so csv-stringify emits one cell, not [object Object].
  return stringify(
    rows.map((row) => ({ ...row, detail: row.detail == null ? "" : JSON.stringify(row.detail) })),
    { header: true, columns: COLUMNS },
  );
}
