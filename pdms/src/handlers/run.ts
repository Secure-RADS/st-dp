import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { introspectAccessToken } from "../lib/verifierClient.js";

interface RunBody {
  accessToken: string;
}

function isRunBody(body: unknown): body is RunBody {
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as Record<string, unknown>).accessToken === "string";
}

// Stub only - real personal-data storage/retrieval is explicitly future
// work. This just proves the loop: sce-unit's access token gets checked
// with verifier-service before PDMS does anything on its behalf, without
// PDMS ever having to redo attestation verification itself.
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

  if (!isRunBody(body)) {
    return { statusCode: 400, body: "expected accessToken as a string" };
  }

  const introspection = await introspectAccessToken(body.accessToken);
  if (!introspection.active) {
    return { statusCode: 401, body: "access token is not active" };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ status: "ok", algorithmId: introspection.algorithmId, note: "PDMS stub - no real data plane yet" }),
  };
};
