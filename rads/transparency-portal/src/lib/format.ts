export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function shortId(value: string | null | undefined, length = 14): string {
  if (!value) return "-";
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}

export function isFailureEvent(event: string): boolean {
  return event.endsWith("-failed");
}
