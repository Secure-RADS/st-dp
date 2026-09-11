import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});
const queueUrl = process.env.LOG_EVENTS_QUEUE_URL;

// Fire-and-forget one timeline event to the rads-log-events SQS queue. Best-effort: a logging failure must
// never fail the upload, and an unset queue URL is a no-op.
export async function emitAlgorithmRegistered(algorithmId: string, bucket: string, key: string): Promise<void> {
  if (!queueUrl) return;
  const body = JSON.stringify({
    algorithmId,
    runId: "",
    event: "algorithm-registered",
    timestamp: new Date().toISOString(),
    detail: { bucket, key },
  });
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  } catch (err) {
    console.error("log event failed", "algorithm-registered", err);
  }
}
