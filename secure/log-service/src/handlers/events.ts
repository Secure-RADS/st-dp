import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireEnclaveToken } from "../lib/auth.js";
import { isEnclaveEvent, isHostRelayEvent } from "../lib/events.js";
import { parseIngestBody } from "../lib/ingest.js";
import { enqueueEvent } from "../lib/queue.js";

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Public domain: only sce-unit may write here, with the verifier-issued access token. Host events arrive
// relayed by sce-unit and keep origin=host so they are not mistaken for enclave claims.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const parsed = parseIngestBody(body);
  if ("error" in parsed) return jsonResponse(400, { error: parsed.error });
  if (!isEnclaveEvent(parsed.event) && !isHostRelayEvent(parsed.event)) {
    return jsonResponse(400, { error: "event is not accepted on this endpoint" });
  }

  const authError = await requireEnclaveToken(event.headers.authorization, parsed.algorithmId);
  if (authError) return jsonResponse(401, { error: authError });

  await enqueueEvent({ ...parsed, auth: "attested" });
  return jsonResponse(202, { ok: true });
};
