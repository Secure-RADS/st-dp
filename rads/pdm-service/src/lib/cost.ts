import { randomUUID } from "node:crypto";

// Fire-and-forget cost metering. Best-effort: a cost failure must never fail a run, and if COST_HOST is unset
// it is a no-op. Awaited so the request is sent before a Lambda freezes, matching the log-service pattern.
const costEventsUrl = process.env.COST_HOST ? `https://${process.env.COST_HOST}/cost` : undefined;

export type CostPhase = "build" | "execution";
export type AwsService = "s3" | "dynamodb" | "sqs" | "ec2" | "lambda" | "apigateway";
export type CostOperation =
  | "put"
  | "get"
  | "head"
  | "list"
  | "read"
  | "write"
  | "send"
  | "receive"
  | "delete"
  | "instance"
  | "invocation"
  | "compute"
  | "request";

// The default Lambda memory size; Lambda bills compute as duration x configured memory.
const LAMBDA_MEMORY_MB = 1024;

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
    await fetch(costEventsUrl, {
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
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error(`cost event ${service}:${operation} failed`, error);
  }
}

export async function recordRequest(
  algorithmId: string,
  runId: string,
  phase: CostPhase,
  startedAtNs: bigint,
): Promise<void> {
  const seconds = Number(process.hrtime.bigint() - startedAtNs) / 1e9;
  await Promise.all([
    costEvent(algorithmId, runId, phase, "apigateway", "request", 1),
    costEvent(algorithmId, runId, phase, "lambda", "invocation", 1),
    costEvent(algorithmId, runId, phase, "lambda", "compute", seconds * (LAMBDA_MEMORY_MB / 1024)),
  ]);
}
