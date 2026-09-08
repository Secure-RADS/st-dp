import { isRunEvent, RUN_EVENTS } from "./events.js";

export interface IngestedEvent {
  algorithmId: string;
  runId: string;
  event: string;
  timestamp: string;
  detail: Record<string, unknown> | null;
  receivedAt: string;
}

export function parseIngestBody(body: unknown): IngestedEvent | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }

  const { algorithmId, runId, event: name, timestamp, detail } = body as Record<string, unknown>;
  for (const [key, value] of [
    ["algorithmId", algorithmId],
    ["runId", runId],
    ["event", name],
    ["timestamp", timestamp],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      return { error: `${key} must be a non-empty string` };
    }
  }
  if (!isRunEvent(name)) {
    return { error: `unknown event; allowed: ${RUN_EVENTS.join(", ")}` };
  }
  if (detail !== undefined && (typeof detail !== "object" || detail === null)) {
    return { error: "detail must be an object" };
  }

  return {
    algorithmId: algorithmId as string,
    runId: runId as string,
    event: name,
    timestamp: timestamp as string,
    detail: (detail as Record<string, unknown> | undefined) ?? null,
    receivedAt: new Date().toISOString(),
  };
}
