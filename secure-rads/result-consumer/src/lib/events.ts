// Keep this type-only event list in sync with log-service/src/lib/events.ts.
const RUN_EVENTS = [
  "build-started",
  "build-completed",
  "image-uploaded",
  "pcrs-registered",
  "kms-key-provisioned",
  "algorithm-registered",
  "build-failed",
  "run-requested",
  "executor-launched",
  "executor-ready",
  "artifact-retrieved",
  "enclave-launched",
  "launch-failed",
  "executor-finished",
  "enclave-started",
  "unit-ready",
  "attested",
  "records-fetched",
  "records-decrypted",
  "records-stored-locally",
  "dc-app-completed",
  "output-sent",
  "run-failed",
  "result-persisted",
] as const;

export type RunEvent = (typeof RUN_EVENTS)[number];
