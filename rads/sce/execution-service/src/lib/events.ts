import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requiredEnv } from "./env.js";

const sqs = new SQSClient({});
const logEventsQueueUrl = requiredEnv("LOG_EVENTS_QUEUE_URL");

export type RunEvent = "run-requested" | "executor-launched" | "launch-failed";

// Fire-and-forget one lifecycle event onto the rads-log-events queue; the log-service worker persists it.
export async function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: logEventsQueueUrl,
        MessageBody: JSON.stringify({ algorithmId, runId, event, timestamp: new Date().toISOString(), detail }),
      }),
    );
  } catch (error) {
    console.error(`log event ${event} failed`, error);
  }
}
