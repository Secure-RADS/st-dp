import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getPublicJwk } from "../lib/jwt.js";

// Public JWKS for the ES256 access tokens issued by /attest and /refresh - downstream services (PDM)
// fetch this and verify tokens locally. The key is public by definition, so this needs no auth; served on
// the public domain.
export const handler: APIGatewayProxyHandlerV2 = async () => {
  const jwk = await getPublicJwk();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys: [jwk] }),
  };
};
