import { emitEvent } from "@sce/sdk/log";
import type { RunEvent } from "./events.js";

export function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  return emitEvent(algorithmId, runId, event, detail);
}
