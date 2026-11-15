import { postInternal } from "./mtls.js";

// secure-rads internal producers use the mTLS domain. Keep the best-effort failure behavior of the plain
// HTTP path so a log-service hiccup never breaks the caller.
export async function emitSecureEvent(
  algorithmId: string,
  runId: string | null,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await postInternal("/events", { algorithmId, runId, event, timestamp: new Date().toISOString(), detail });
  } catch (error) {
    console.error(`log event ${event} failed`, error);
  }
}
