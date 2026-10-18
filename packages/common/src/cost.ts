import { randomUUID } from "node:crypto";

export const CostPhase = {
  Build: "build",
  Execution: "execution",
} as const;
export type CostPhase = (typeof CostPhase)[keyof typeof CostPhase];

export const AWS_SERVICES = ["s3", "dynamodb", "sqs", "ec2", "lambda", "apigateway"] as const;
export type AwsService = (typeof AWS_SERVICES)[number];

const COST_UNITS = ["request", "byte", "read-request-unit", "write-request-unit", "second", "gb-second"] as const;
export type CostUnit = (typeof COST_UNITS)[number];

export const COST_OPERATIONS = {
  s3: ["put", "get", "head", "list"],
  dynamodb: ["read-capacity", "write-capacity", "read", "write"],
  sqs: ["send", "receive", "delete"],
  ec2: ["instance"],
  lambda: ["invocation", "compute"],
  apigateway: ["request"],
} as const;

type OperationsByService = typeof COST_OPERATIONS;
export type CostOperation = OperationsByService[AwsService][number];

export function isCostPhase(value: unknown): value is CostPhase {
  return typeof value === "string" && (Object.values(CostPhase) as readonly string[]).includes(value);
}

export function isAwsService(value: unknown): value is AwsService {
  return typeof value === "string" && (AWS_SERVICES as readonly string[]).includes(value);
}

export function isValidOperation(service: AwsService, operation: unknown): operation is CostOperation {
  return typeof operation === "string" && (COST_OPERATIONS[service] as readonly string[]).includes(operation);
}

const costEventsUrl = process.env.COST_HOST ? `https://${process.env.COST_HOST}/cost` : undefined;

// Bound metering latency so a slow cost-service cannot consume the producer's Lambda timeout.
const COST_EVENT_TIMEOUT_MS = 1_000;

// Lambda compute cost scales with configured memory, which defaults to 1024 MB here.
const LAMBDA_MEMORY_MB = 1024;

// Await metering before Lambda freeze, but never fail the caller when cost reporting fails.
export async function costEvent(
  algorithmId: string,
  runId: string,
  phase: CostPhase,
  service: AwsService,
  operation: CostOperation,
  quantity: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!costEventsUrl || !algorithmId || !runId || quantity < 0) return;
  try {
    const response = await fetch(costEventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        algorithmId,
        runId,
        eventId: randomUUID(),
        phase,
        service,
        operation,
        quantity,
        timestamp: new Date().toISOString(),
        detail,
      }),
      signal: AbortSignal.timeout(COST_EVENT_TIMEOUT_MS),
    });
    if (!response.ok) console.error(`cost event ${service}:${operation} rejected with HTTP ${response.status}`);
  } catch (error) {
    console.error(`cost event ${service}:${operation} failed`, error);
  }
}

function elapsedGbSeconds(startedAtNs: bigint): number {
  const seconds = Number(process.hrtime.bigint() - startedAtNs) / 1e9;
  return seconds * (LAMBDA_MEMORY_MB / 1024);
}

function lambdaEvents(algorithmId: string, runId: string, phase: CostPhase, gbSeconds: number): Promise<void>[] {
  return [
    costEvent(algorithmId, runId, phase, "lambda", "invocation", 1),
    costEvent(algorithmId, runId, phase, "lambda", "compute", gbSeconds),
  ];
}

export async function recordRequest(
  algorithmId: string,
  runId: string,
  phase: CostPhase,
  startedAtNs: bigint,
): Promise<void> {
  await Promise.all([
    costEvent(algorithmId, runId, phase, "apigateway", "request", 1),
    ...lambdaEvents(algorithmId, runId, phase, elapsedGbSeconds(startedAtNs)),
  ]);
}

export async function recordLambda(
  algorithmId: string,
  runId: string,
  phase: CostPhase,
  startedAtNs: bigint,
): Promise<void> {
  await Promise.all(lambdaEvents(algorithmId, runId, phase, elapsedGbSeconds(startedAtNs)));
}
