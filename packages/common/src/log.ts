const telemetryHost = process.env.TELEMETRY_HOST;
const eventsUrl = telemetryHost ? `https://${telemetryHost}/events` : undefined;

const LOG_EVENT_TIMEOUT_MS = 5_000;

// Await best-effort logging so Lambda freeze does not drop telemetry events.
export async function emitEvent(
  algorithmId: string,
  runId: string | null,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!eventsUrl) return;
  try {
    await fetch(eventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ algorithmId, runId, event, timestamp: new Date().toISOString(), detail }),
      signal: AbortSignal.timeout(LOG_EVENT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`log event ${event} failed`, error);
  }
}
