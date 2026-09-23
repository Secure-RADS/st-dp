import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { RegistryEvent } from "./events.js";

const sqs = new SQSClient({});
const queueUrl = process.env.LOG_QUEUE_URL;

// Best-effort: a logging failure must never fail the registration, and an unset queue URL is a no-op.
export async function emitAlgorithmRegistered(algorithmId: string, bucket: string, key: string): Promise<void> {
  if (!queueUrl) return;
  const body = JSON.stringify({
    type: "run-event",
    algorithmId,
    runId: null,
    event: RegistryEvent.AlgorithmRegistered,
    timestamp: new Date().toISOString(),
    detail: { bucket, key },
  });
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  } catch (err) {
    console.error("log event failed", RegistryEvent.AlgorithmRegistered, err);
  }
}
