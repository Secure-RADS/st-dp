import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { RunEvent } from "./events.js";

const sqs = new SQSClient({});
const queueUrl = process.env.LOG_QUEUE_URL;

// Fire-and-forget one timeline event onto the log queue. Best-effort: a logging failure must never fail the
// consumer, and if LOG_QUEUE_URL is unset it's a no-op.
export async function logEvent(
  algorithmId: string,
  runId: string,
  event: RunEvent,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!queueUrl || !algorithmId || !runId) return;
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
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
  } catch (err) {
    console.error("log event failed", event, err);
  }
}
