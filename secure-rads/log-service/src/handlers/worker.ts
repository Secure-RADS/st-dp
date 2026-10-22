import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";
import type { SQSHandler } from "aws-lambda";
import type { IngestedEvent } from "../lib/ingest.js";
import { LOG_PARTITION } from "../lib/runLog.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

async function persist(item: IngestedEvent): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        AlgorithmId: item.algorithmId,
        // Event name instead of a random nonce, so a redelivered message overwrites rather than duplicates.
        Sk: `${item.runId ?? ""}#${item.timestamp}#${item.event}`,
        RunId: item.runId,
        LogPartition: LOG_PARTITION,
        // Only set for execution events. A GSI key attribute carrying the wrong type (NULL) would make
        // DynamoDB reject the write, so build events omit it and stay out of RunIndex entirely.
        ...(item.runId ? { RunIdKey: item.runId } : {}),
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
