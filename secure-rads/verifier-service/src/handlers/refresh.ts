import { CostPhase, recordRequest } from "@srads/common/cost";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { refreshAccessToken } from "../lib/tokens.js";

interface RefreshBody {
  refreshToken: string;
  runId: string;
}

function isRefreshBody(body: unknown): body is RefreshBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.refreshToken === "string" && typeof b.runId === "string";
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

  if (!isRefreshBody(body)) {
    return { statusCode: 400, body: "expected refreshToken and runId as strings" };
  }

  const result = await refreshAccessToken(body.refreshToken);
  if (!result) {
    return { statusCode: 401, body: "refresh token invalid, expired, or revoked" };
  }

  await recordRequest(result.algorithmId, body.runId, CostPhase.Execution, startedAt);
  return { statusCode: 200, body: JSON.stringify(result.tokens) };
};
