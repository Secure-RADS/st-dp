import { emitEvent } from "@sce/sdk/log";

export type RunEvent = "run-requested" | "executor-launched" | "launch-failed";

export function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  return emitEvent(algorithmId, runId, event, detail);
}
