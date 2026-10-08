import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSHandler } from "aws-lambda";
import { costUsd, priceFor, unitFor } from "../lib/calc.js";
import { requiredEnv } from "../lib/env.js";
import type { IngestedCostEvent } from "../lib/ingest.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("COST_TABLE");

async function persist(item: IngestedCostEvent): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        AlgorithmId: item.algorithmId,
        Sk: `${item.runId}#${item.timestamp}#${item.eventId}`,
        RunId: item.runId,
        EventId: item.eventId,
        Phase: item.phase,
        Service: item.service,
        Operation: item.operation,
        Quantity: item.quantity,
        Unit: unitFor(item.service, item.operation),
        CostUsd: costUsd(priceFor(item.service, item.operation), item.quantity),
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
      await persist(JSON.parse(record.body) as IngestedCostEvent);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
