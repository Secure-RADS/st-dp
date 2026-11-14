import { isHostEvent, isRunEvent, RUN_EVENTS } from "./events.js";

type EventAuth = "attested" | "mtls" | "none";
type EventOrigin = "enclave" | "host" | "service";

export interface ParsedEvent {
  algorithmId: string;
  runId: string | null;
  event: string;
  timestamp: string;
  detail: Record<string, unknown> | null;
  receivedAt: string;
  origin: EventOrigin;
}

export interface IngestedEvent extends ParsedEvent {
  auth: EventAuth;
}

export function parseIngestBody(body: unknown): ParsedEvent | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }

  const { algorithmId, runId, event: name, timestamp, detail, origin } = body as Record<string, unknown>;
  for (const [key, value] of [
    ["algorithmId", algorithmId],
    ["event", name],
    ["timestamp", timestamp],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      return { error: `${key} must be a non-empty string` };
    }
  }
  // Build events have no runId; execution events include one.
  if (runId != null && (typeof runId !== "string" || runId.length === 0)) {
    return { error: "runId must be a non-empty string when present" };
  }
  if (!isRunEvent(name)) {
    return { error: `unknown event; allowed: ${RUN_EVENTS.join(", ")}` };
  }
  if (detail !== undefined && (typeof detail !== "object" || detail === null)) {
    return { error: "detail must be an object" };
  }
  if (!isHostEvent(name) && origin !== undefined) {
    return { error: "origin is only accepted for host events" };
  }

  return {
    algorithmId: algorithmId as string,
    runId: (runId as string | undefined) ?? null,
    event: name,
    timestamp: timestamp as string,
    detail: (detail as Record<string, unknown> | undefined) ?? null,
    receivedAt: new Date().toISOString(),
    origin: isHostEvent(name) ? "host" : "enclave",
  };
}
