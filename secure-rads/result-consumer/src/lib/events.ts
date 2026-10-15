// Run-timeline event names, mirrored from log-service (the ingest authority). result-consumer only needs the
// type; keep the list in sync with log-service/src/lib/events.ts.
const RUN_EVENTS = [
  // Build phase (registry-service); runId is the build id.
  "build-started",
  "build-completed",
  "image-uploaded",
  "pcrs-registered",
  "kms-key-provisioned",
  "algorithm-registered",
  "build-failed",
  // Execution phase (execution-service).
  "run-requested",
  "executor-launched",
  "executor-ready",
  "artifact-retrieved",
  "enclave-launched",
  "launch-failed",
  "executor-finished",
  // Inside the enclave (sce-unit).
  "enclave-started",
  "unit-ready",
  "attested",
  "records-fetched",
  "records-decrypted",
  "records-stored-locally",
  "dc-app-completed",
  "output-sent",
  "run-failed",
  // Result delivery (result-consumer).
  "result-persisted",
] as const;

export type RunEvent = (typeof RUN_EVENTS)[number];
