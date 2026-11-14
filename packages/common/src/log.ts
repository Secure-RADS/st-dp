import { internalLogConfigured, postInternal } from "./mtls.js";

const logHost = process.env.LOG_HOST;
const eventsUrl = logHost ? `https://${logHost}/events` : undefined;
const subjectAccessUrl = logHost ? `https://${logHost}/subject-access` : undefined;

const LOG_EVENT_TIMEOUT_MS = 5_000;

// Await best-effort logging so Lambda freeze does not drop timeline events.
export async function emitEvent(
  algorithmId: string,
  runId: string | null,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!internalLogConfigured && !eventsUrl) return;
  const payload = { algorithmId, runId, event, timestamp: new Date().toISOString(), detail };
  try {
    if (internalLogConfigured) {
      await postInternal("/events", payload);
      return;
    }
    if (!eventsUrl) return;
    await fetch(eventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LOG_EVENT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`log event ${event} failed`, error);
  }
}

export async function logSubjectAccess(
  algorithmId: string,
  runId: string,
  dataSubjectIds: string[],
  accessToken?: string,
): Promise<void> {
  if (!subjectAccessUrl || dataSubjectIds.length === 0) return;
  try {
    await fetch(subjectAccessUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ algorithmId, runId, dataSubjectIds, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(LOG_EVENT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("subject-access log failed", error);
  }
}
