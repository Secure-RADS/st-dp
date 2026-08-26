import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { refreshAccessToken } from "../lib/tokens.js";

interface RefreshBody {
  refreshToken: string;
}

function isRefreshBody(body: unknown): body is RefreshBody {
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as Record<string, unknown>).refreshToken === "string";
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
    return { statusCode: 400, body: "expected refreshToken as a string" };
  }

  const tokens = await refreshAccessToken(body.refreshToken);
  if (!tokens) {
    return { statusCode: 401, body: "refresh token invalid, expired, or revoked" };
  }

  return { statusCode: 200, body: JSON.stringify(tokens) };
};
