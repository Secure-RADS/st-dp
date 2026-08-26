export interface EventRow {
  algorithmId: string;
  runId: string;
  event: string;
  timestamp: string;
  receivedAt: string;
  detail: unknown;
}

const COLUMNS = ["algorithmId", "runId", "event", "timestamp", "receivedAt", "detail"] as const;

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: EventRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escapeCell(row.algorithmId),
        escapeCell(row.runId),
        escapeCell(row.event),
        escapeCell(row.timestamp),
        escapeCell(row.receivedAt),
        escapeCell(row.detail == null ? "" : JSON.stringify(row.detail)),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
