import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { isRunEvent, RUN_EVENTS } from "../lib/events.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Fire-and-forget hot path: producers (execution-service, enclave host, sce-unit, result-consumer) POST one
// timestamped run event. The timestamp is the client's - when the event happened, not server receive time.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse(400, { error: "body must be a JSON object" });
  }

  const { algorithmId, runId, event: name, timestamp, detail } = body as Record<string, unknown>;
  for (const [key, value] of [
    ["algorithmId", algorithmId],
    ["runId", runId],
    ["event", name],
    ["timestamp", timestamp],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      return jsonResponse(400, { error: `${key} must be a non-empty string` });
    }
  }
  if (!isRunEvent(name)) {
    return jsonResponse(400, { error: `unknown event; allowed: ${RUN_EVENTS.join(", ")}` });
  }
  if (detail !== undefined && (typeof detail !== "object" || detail === null)) {
    return jsonResponse(400, { error: "detail must be an object" });
  }

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        AlgorithmId: algorithmId,
        Sk: `${runId as string}#${timestamp as string}#${randomUUID()}`,
        RunId: runId,
        Event: name,
        Timestamp: timestamp,
        ReceivedAt: new Date().toISOString(),
        Detail: detail ?? null,
      },
    }),
  );

  return jsonResponse(202, { ok: true });
};
