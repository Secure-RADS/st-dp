export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function shortId(value: string, length = 14): string {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}

export function isFailureEvent(event: string): boolean {
  return event.endsWith("-failed");
}
