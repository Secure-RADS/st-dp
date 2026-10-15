// Run-timeline event names, mirrored from log-service (the ingest authority). result-consumer only needs the
// type; keep the list in sync with log-service/src/lib/events.ts.
const RUN_EVENTS = [
  "image-uploaded",
  "algorithm-registered",
  "run-requested",
  "executor-launched",
  "launch-failed",
  "executor-ready",
  "artifact-retrieved",
  "records-fetched",
  "records-stored-locally",
  "compute-completed",
  "executor-finished",
  "result-persisted",
] as const;

export type RunEvent = (typeof RUN_EVENTS)[number];
