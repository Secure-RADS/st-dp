import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSHandler } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import type { IngestedEvent } from "../lib/ingest.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

async function persist(item: IngestedEvent): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        AlgorithmId: item.algorithmId,
        // Event name instead of a random nonce, so a redelivered message overwrites rather than duplicates.
        Sk: `${item.runId}#${item.timestamp}#${item.event}`,
        RunId: item.runId,
        Event: item.event,
        Timestamp: item.timestamp,
        ReceivedAt: item.receivedAt,
        Detail: item.detail,
      },
    }),
  );
}

export const handler: SQSHandler = async (event) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      await persist(JSON.parse(record.body) as IngestedEvent);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
