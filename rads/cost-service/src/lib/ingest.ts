import {
  AWS_SERVICES,
  type AwsService,
  COST_OPERATIONS,
  type CostOperation,
  CostPhase,
  isAwsService,
  isCostPhase,
  isValidOperation,
} from "@srads/common/cost";

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

// Including eventId in the sort key makes SQS redelivery overwrite the row instead of double-counting cost.
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
    return { error: `unknown phase: ${String(phase)}; allowed: ${Object.values(CostPhase).join(", ")}` };
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
