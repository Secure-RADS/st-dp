const COUNT_TIMEOUT_MS = 5000;

// The count lives in PDM, not in this Lambda's DynamoDB permissions. `size` lets PDM stop early; the result
// may then be a lower bound, which is enough for the size check.
export async function fetchAlgorithmRecordCount(
  pdmUrl: string,
  algorithmId: string,
  atLeast: number,
  runId: string,
): Promise<number> {
  const url = new URL("/count", pdmUrl);
  url.searchParams.set("algorithmId", algorithmId);
  url.searchParams.set("size", String(atLeast));

  const response = await fetch(url, {
    headers: { "x-run-id": runId },
    signal: AbortSignal.timeout(COUNT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`PDM count returned ${response.status}`);
  }
  const body = (await response.json()) as { count?: unknown };
  if (typeof body.count !== "number") {
    throw new Error("PDM count response missing count");
  }
  return body.count;
}
