import {
  AWS_SERVICES,
  type AwsService,
  COST_OPERATIONS,
  COST_PHASES,
  type CostOperation,
  type CostPhase,
  isAwsService,
  isCostPhase,
  isValidOperation,
} from "./cost.js";

export interface IngestedCostEvent {
  algorithmId: string;
  runId: string;
  eventId: string;
  phase: CostPhase;
  service: AwsService;
  operation: CostOperation;
  quantity: number;
  timestamp: string;
  detail: Record<string, unknown> | null;
  receivedAt: string;
}

// eventId is producer-generated and becomes part of the sort key, so an SQS redelivery overwrites the item
// instead of double-counting the operation's cost.
export function parseCostBody(body: unknown): IngestedCostEvent | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }

  const { algorithmId, runId, eventId, phase, service, operation, quantity, timestamp, detail } = body as Record<
    string,
    unknown
  >;
  for (const [key, value] of [
    ["algorithmId", algorithmId],
    ["runId", runId],
    ["eventId", eventId],
    ["timestamp", timestamp],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      return { error: `${key} must be a non-empty string` };
    }
  }
  if (!isCostPhase(phase)) {
    return { error: `unknown phase: ${String(phase)}; allowed: ${COST_PHASES.join(", ")}` };
  }
  if (!isAwsService(service)) {
    return { error: `unknown service: ${String(service)}; allowed: ${AWS_SERVICES.join(", ")}` };
  }
  if (!isValidOperation(service, operation)) {
    return {
      error: `unknown operation for ${service}: ${String(operation)}; allowed: ${COST_OPERATIONS[service].join(", ")}`,
    };
  }
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
    return { error: "quantity must be a non-negative number" };
  }
  if (detail !== undefined && (typeof detail !== "object" || detail === null)) {
    return { error: "detail must be an object" };
  }

  return {
    algorithmId: algorithmId as string,
    runId: runId as string,
    eventId: eventId as string,
    phase,
    service,
    operation,
    quantity,
    timestamp: timestamp as string,
    detail: (detail as Record<string, unknown> | undefined) ?? null,
    receivedAt: new Date().toISOString(),
  };
}
