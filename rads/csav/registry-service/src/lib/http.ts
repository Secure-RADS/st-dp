export function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function parseBody(body: string | undefined): unknown {
  try {
    return JSON.parse(body ?? "");
  } catch {
    return undefined;
  }
}
