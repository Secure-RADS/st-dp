import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { RegistryEvent, type RegistryEventName } from "./events.js";

const sqs = new SQSClient({});
const queueUrl = process.env.LOG_EVENTS_QUEUE_URL;

// Best-effort: a logging failure must never fail the registration, and an unset queue URL is a no-op.
async function emitEvent(event: RegistryEventName, algorithmId: string, bucket: string, key: string): Promise<void> {
  if (!queueUrl) return;
  const body = JSON.stringify({
    algorithmId,
    runId: null,
    event,
    timestamp: new Date().toISOString(),
    detail: { bucket, key },
  });
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  } catch (err) {
    console.error("log event failed", event, err);
  }
}

export function emitImageUploaded(algorithmId: string, bucket: string, key: string): Promise<void> {
  return emitEvent(RegistryEvent.ImageUploaded, algorithmId, bucket, key);
}

export function emitAlgorithmRegistered(algorithmId: string, bucket: string, key: string): Promise<void> {
  return emitEvent(RegistryEvent.AlgorithmRegistered, algorithmId, bucket, key);
}
