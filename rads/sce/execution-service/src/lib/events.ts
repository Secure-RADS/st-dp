import { requiredEnv } from "./env.js";

const logEventsUrl = `https://${requiredEnv("LOG_HOST")}/events`;

export type RunEvent =
  | "run-requested"
  | "executor-launched"
  | "launch-failed"
  | "executor-ready"
  | "artifact-retrieved"
  | "records-fetched"
  | "records-stored-locally"
  | "compute-completed"
  | "executor-finished";

export async function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(logEventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ algorithmId, runId, event, timestamp: new Date().toISOString(), detail }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error(`log event ${event} failed`, error);
  }
}
