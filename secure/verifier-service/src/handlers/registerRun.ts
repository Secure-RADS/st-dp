import { CostPhase, recordRequest } from "@srads/common/cost";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { registerRunBinding } from "../lib/runBinding.js";

interface RegisterRunBody {
  algorithmId: string;
  runId: string;
  runSecret: string;
}

function isRegisterRunBody(body: unknown): body is RegisterRunBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return [b.algorithmId, b.runId, b.runSecret].every((value) => typeof value === "string" && value.length > 0);
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  if (!event.body) {
    return { statusCode: 400, body: "missing request body" };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "invalid JSON" };
  }

  if (!isRegisterRunBody(body)) {
    return { statusCode: 400, body: "expected algorithmId, runId, and runSecret as non-empty strings" };
  }

  try {
    await registerRunBinding(body.algorithmId, body.runId, body.runSecret);
    return { statusCode: 201, body: JSON.stringify({ runId: body.runId }) };
  } finally {
    await recordRequest(body.algorithmId, body.runId, CostPhase.Execution, startedAt);
  }
};
