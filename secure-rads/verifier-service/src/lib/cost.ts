import { randomUUID } from "node:crypto";

// Fire-and-forget cost metering. Best-effort: a cost failure must never fail a request, and if COST_HOST is
// unset it is a no-op. Awaited so the request is sent before a Lambda freezes, matching the log-service pattern.
const costEventsUrl = process.env.COST_HOST ? `https://${process.env.COST_HOST}/cost` : undefined;

// Cap the awaited cost POST so a slow cost-service cannot outlast the producer's own Lambda timeout.
const COST_EVENT_TIMEOUT_MS = 1_000;

// The default Lambda memory size; Lambda bills compute as duration x configured memory.
const LAMBDA_MEMORY_MB = 1024;

type CostPhase = "build" | "execution";

async function costEvent(
  algorithmId: string,
  runId: string,
  phase: CostPhase,
  service: "apigateway" | "lambda",
  operation: "request" | "invocation" | "compute",
  quantity: number,
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
      }),
      signal: AbortSignal.timeout(COST_EVENT_TIMEOUT_MS),
    });
    if (!response.ok) console.error(`cost event ${service}:${operation} rejected with HTTP ${response.status}`);
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
