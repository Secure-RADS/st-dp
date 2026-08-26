import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { validateAccessToken } from "../lib/tokens.js";

interface ValidateBody {
  accessToken: string;
}

function isValidateBody(body: unknown): body is ValidateBody {
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as Record<string, unknown>).accessToken === "string";
}

// What downstream services call (over their own mTLS client cert - see serverless.yml) to check whether an
// access token sce-unit presented is currently valid, without ever needing to redo attestation verification.
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

  if (!isValidateBody(body)) {
    return { statusCode: 400, body: "expected accessToken as a string" };
  }

  const session = await validateAccessToken(body.accessToken);
  if (!session) {
    return { statusCode: 200, body: JSON.stringify({ active: false }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ active: true, algorithmId: session.algorithmId }),
  };
};
