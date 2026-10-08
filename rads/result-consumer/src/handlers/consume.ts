import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSHandler, SQSRecord } from "aws-lambda";
import { costEvent, recordLambda } from "../lib/cost.js";
import { requiredEnv } from "../lib/env.js";
import { logEvent } from "../lib/log.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_RESULTS_TABLE");

interface RunResultMessage {
  runId: string;
  instanceId?: string;
  algorithmId?: string;
  status?: string;
  output?: string;
  diag?: unknown;
}

function messageId(record: SQSRecord): { algorithmId: string; runId: string } | undefined {
  try {
    const message = JSON.parse(record.body) as RunResultMessage;
    if (typeof message.algorithmId === "string" && typeof message.runId === "string") {
      return { algorithmId: message.algorithmId, runId: message.runId };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// Consumes executor run-result messages off RunResultsQueue and persists them to the RunResults table,
// where execution-service's GET /run/{runId} reads them back. The batch's records are handled concurrently.
async function persist(record: SQSRecord): Promise<void> {
  let message: RunResultMessage;
  try {
    message = JSON.parse(record.body) as RunResultMessage;
  } catch {
    // A malformed message shouldn't poison the batch and block good ones - skip it, let it age to the DLQ.
    console.error("skipping message with unparsable body", record.messageId);
    return;
  }
  if (typeof message.runId !== "string") {
    console.error("skipping message with missing/invalid runId", record.messageId);
    return;
  }

  const item = {
    RunId: message.runId,
    InstanceId: message.instanceId,
    AlgorithmId: message.algorithmId,
    Status: message.status,
    Output: message.output ?? "",
    Diag: message.diag ?? null,
    ReceivedAt: new Date().toISOString(),
  };

  // PutItem is idempotent on RunId, so a batch retry on a DynamoDB error is safe.
  await ddb.send(new PutCommand({ TableName: table, Item: item }));

  if (message.algorithmId) {
    await costEvent(
      message.algorithmId,
      message.runId,
      "execution",
      "dynamodb",
      "write",
      Buffer.byteLength(JSON.stringify(item)),
    );
    await logEvent(message.algorithmId, message.runId, "result-persisted", { status: message.status });
  }
}

export const handler: SQSHandler = async (event) => {
  const startedAt = process.hrtime.bigint();
  await Promise.all(event.Records.map(persist));

  const first = event.Records.map(messageId).find((ids) => ids !== undefined);
  if (first) {
    // One ReceiveMessage request returns the whole batch, billed per 64KB of returned payload.
    const bytes = event.Records.reduce((total, record) => total + Buffer.byteLength(record.body), 0);
    await costEvent(first.algorithmId, first.runId, "execution", "sqs", "receive", Math.max(1, bytes));
    await recordLambda(first.algorithmId, first.runId, "execution", startedAt);
  }
};
