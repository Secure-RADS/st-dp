import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { parseIngestBody } from "../lib/ingest.js";
import { enqueueEvent } from "../lib/queue.js";

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Diagnostic telemetry: performance, test, and debug events. There is no authentication, so any producer
// that can reach the endpoint may append to the timeline.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const parsed = parseIngestBody(body);
  if ("error" in parsed) return jsonResponse(400, { error: parsed.error });

  await enqueueEvent(parsed);
  return jsonResponse(202, { ok: true });
};
