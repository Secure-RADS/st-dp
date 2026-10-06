import type { RunEvent } from "./events.js";

const url = process.env.LOG_EVENTS_URL;

// Fire-and-forget one timeline event to log-service. Best-effort: a logging failure must never fail the
// consumer, and if LOG_EVENTS_URL is unset it's a no-op.
export async function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!url || !algorithmId || !runId) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ algorithmId, runId, event, timestamp: new Date().toISOString(), detail }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error("log event failed", event, err);
  }
}
