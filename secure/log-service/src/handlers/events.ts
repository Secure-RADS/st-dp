import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireEnclaveToken } from "../lib/auth.js";
import { isEnclaveEvent, isHostEvent, isPreAttestationEvent } from "../lib/events.js";
import { parseIngestBody } from "../lib/ingest.js";
import { enqueueEvent } from "../lib/queue.js";

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Public domain: sce-unit writes here. Events emitted after attestation carry the verifier-issued access
// token; pre-attestation and host events are accepted unauthenticated and tagged auth=none.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const parsed = parseIngestBody(body);
  if ("error" in parsed) return jsonResponse(400, { error: parsed.error });
  const authenticated = isEnclaveEvent(parsed.event);
  if (!authenticated && !isPreAttestationEvent(parsed.event) && !isHostEvent(parsed.event)) {
    return jsonResponse(400, { error: "event is not accepted on this endpoint" });
  }

  if (authenticated) {
    const authError = await requireEnclaveToken(event.headers.authorization, parsed.algorithmId, parsed.runId);
    if (authError) return jsonResponse(401, { error: authError });
  }

  await enqueueEvent({ ...parsed, auth: authenticated ? "attested" : "none" });
  return jsonResponse(202, { ok: true });
};
