// Run-timeline event names, mirrored from log-service (the ingest authority). result-consumer only needs the
// type; keep the list in sync with log-service/src/lib/events.ts.
const RUN_EVENTS = [
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
