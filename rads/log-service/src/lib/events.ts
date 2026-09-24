// Canonical rads run-timeline event names. Every producer emits one of these; log-service rejects anything else
// at ingest. Producers (registry, execution control plane, the EC2 executor) mirror this list - keep them in sync.
export const RUN_EVENTS = [
  // Build phase (registry-service); no runId (the build records the algorithm).
  "image-uploaded",
  "algorithm-registered",
  // Execution phase (execution-service control plane).
  "run-requested",
  "executor-launched",
  "launch-failed",
  // Executor (EC2): provisioning, then the run steps in order.
  "executor-ready",
  "artifact-retrieved",
  "records-fetched",
  "compute-completed",
  "executor-finished",
] as const;

export type RunEvent = (typeof RUN_EVENTS)[number];

export function isRunEvent(value: unknown): value is RunEvent {
  return typeof value === "string" && (RUN_EVENTS as readonly string[]).includes(value);
}
