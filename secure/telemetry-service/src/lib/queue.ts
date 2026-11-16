import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requiredEnv } from "@srads/common/env";
import type { IngestedEvent } from "./ingest.js";

const sqs = new SQSClient({});
const queueUrl = requiredEnv("EVENT_QUEUE_URL");

export async function enqueueEvent(item: IngestedEvent): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(item) }));
}
