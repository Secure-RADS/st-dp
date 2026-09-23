import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSHandler } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { parseIngestBody } from "../lib/ingest.js";
import { parseSubjectAccessBody } from "../lib/subjectAccess.js";
import { persistSubjectAccess } from "../lib/subjectAccessWrite.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const runLogTable = requiredEnv("RUN_LOG_TABLE");
const subjectAccessTable = requiredEnv("SUBJECT_ACCESS_TABLE");

async function persistRunEvent(message: unknown): Promise<void> {
  const parsed = parseIngestBody(message);
  if ("error" in parsed) throw new Error(parsed.error);
  await ddb.send(
    new PutCommand({
      TableName: runLogTable,
      Item: {
        AlgorithmId: parsed.algorithmId,
        // Event name instead of a random nonce, so a redelivered message overwrites rather than duplicates.
        Sk: `${parsed.runId ?? ""}#${parsed.timestamp}#${parsed.event}`,
        RunId: parsed.runId,
        Event: parsed.event,
        Timestamp: parsed.timestamp,
        ReceivedAt: parsed.receivedAt,
        Detail: parsed.detail,
      },
    }),
  );
}

async function persistSubjectAccessMessage(message: unknown): Promise<void> {
  const parsed = parseSubjectAccessBody(message);
  if ("error" in parsed) throw new Error(parsed.error);
  await persistSubjectAccess(ddb, subjectAccessTable, parsed);
}

async function route(body: string): Promise<void> {
  const message = JSON.parse(body) as Record<string, unknown>;
  switch (message.type) {
    case "run-event":
      return persistRunEvent(message);
    case "subject-access":
      return persistSubjectAccessMessage(message);
    default:
      throw new Error(`unknown log message type: ${String(message.type)}`);
  }
}

export const handler: SQSHandler = async (event) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      await route(record.body);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
