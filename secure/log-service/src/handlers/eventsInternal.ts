import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { isInternalEvent } from "../lib/events.js";
import { parseIngestBody } from "../lib/ingest.js";
import { enqueueEvent } from "../lib/queue.js";

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// mTLS domain: registry-service, execution-service, and result-consumer. The client certificate is the
// authentication, so these events are tagged auth=mtls and origin=service.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const parsed = parseIngestBody(body);
  if ("error" in parsed) return jsonResponse(400, { error: parsed.error });
  if (!isInternalEvent(parsed.event)) {
    return jsonResponse(400, { error: "event is not accepted on this endpoint" });
  }

  await enqueueEvent({ ...parsed, auth: "mtls", origin: "service" });
  return jsonResponse(202, { ok: true });
};
