import { emitEvent } from "@srads/common/log";

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

export function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  return emitEvent(algorithmId, runId, event, detail);
}
