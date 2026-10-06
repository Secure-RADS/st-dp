import { RegistryEvent, type RegistryEventName } from "./events.js";

const logHost = process.env.LOG_HOST;
const logEventsUrl = logHost ? `https://${logHost}/events` : undefined;

// Best-effort: a logging failure must never fail the registration, and an unset LOG_HOST is a no-op.
async function emitEvent(event: RegistryEventName, algorithmId: string, bucket: string, key: string): Promise<void> {
  if (!logEventsUrl) return;
  try {
    await fetch(logEventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        algorithmId,
        runId: null,
        event,
        timestamp: new Date().toISOString(),
        detail: { bucket, key },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error("log event failed", event, err);
  }
}

export function emitImageUploaded(algorithmId: string, bucket: string, key: string): Promise<void> {
  return emitEvent(RegistryEvent.ImageUploaded, algorithmId, bucket, key);
}

export function emitAlgorithmRegistered(algorithmId: string, bucket: string, key: string): Promise<void> {
  return emitEvent(RegistryEvent.AlgorithmRegistered, algorithmId, bucket, key);
}
