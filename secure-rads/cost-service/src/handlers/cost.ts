import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { parseCostBody } from "../lib/ingest.js";

const sqs = new SQSClient({});
const queueUrl = requiredEnv("COST_QUEUE_URL");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const parsed = parseCostBody(body);
  if ("error" in parsed) return jsonResponse(400, { error: parsed.error });

  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(parsed) }));
  return jsonResponse(202, { ok: true });
};
