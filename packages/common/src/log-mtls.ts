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

export async function logSecureSubjectAccess(
  algorithmId: string,
  runId: string,
  dataSubjectIds: string[],
  accessToken: string,
): Promise<void> {
  if (dataSubjectIds.length === 0) return;
  try {
    await postInternal(
      "/subject-access",
      { algorithmId, runId, dataSubjectIds, timestamp: new Date().toISOString() },
      accessToken,
    );
  } catch (error) {
    console.error("subject-access log failed", error);
  }
}
