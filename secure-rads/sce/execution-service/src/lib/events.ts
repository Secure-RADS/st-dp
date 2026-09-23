import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requiredEnv } from "./env.js";

const sqs = new SQSClient({});
const logQueueUrl = requiredEnv("LOG_QUEUE_URL");

export type RunEvent = "run-requested" | "enclave-launched" | "launch-failed";

// Fire-and-forget one lifecycle event onto the log queue; the log-service worker persists it. Best-effort:
// a logging failure must never fail the run.
export async function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: logQueueUrl,
        MessageBody: JSON.stringify({
          type: "run-event",
          algorithmId,
          runId,
          event,
          timestamp: new Date().toISOString(),
          detail,
        }),
      }),
    );
  } catch (error) {
    console.error(`log event ${event} failed`, error);
  }
}
