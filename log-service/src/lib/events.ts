// Canonical run-timeline event names. Every producer must emit one of these; log-service rejects anything else
// at ingest. Go producers (registry-service, execution-service, sce-unit) mirror this list as typed constants -
// keep them in sync.
export const RUN_EVENTS = [
  // Build phase (registry-service); runId is the build id.
  "build-started",
  "eif-built",
  "pcrs-registered",
  "build-completed",
  "build-failed",
  // Execution phase (execution-service).
  "run-requested",
  "enclave-launched",
  "launch-failed",
  // Inside the enclave (sce-unit).
  "enclave-started",
  "attested",
  "records-fetched",
  "dc-app-completed",
  "output-sent",
  "run-failed",
  // Result delivery (result-consumer).
  "result-persisted",
] as const;

export type RunEvent = (typeof RUN_EVENTS)[number];

export function isRunEvent(value: unknown): value is RunEvent {
  return typeof value === "string" && (RUN_EVENTS as readonly string[]).includes(value);
}
