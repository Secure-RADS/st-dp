import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordLambda } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { SQSHandler, SQSRecord } from "aws-lambda";
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
      CostPhase.Execution,
      "dynamodb",
      "write",
      Buffer.byteLength(JSON.stringify(item)),
    );
    await logEvent(message.algorithmId, message.runId, "result-persisted", { status: message.status });
  }
}

export const handler: SQSHandler = async (event) => {
  const startedAt = process.hrtime.bigint();
  try {
    await Promise.all(event.Records.map(persist));
  } finally {
    const first = event.Records.map(messageId).find((ids) => ids !== undefined);
    if (first) {
      // batchSize is 1: the run owning this message also owns the batch's receive + Lambda cost.
      const bytes = event.Records.reduce((total, record) => total + Buffer.byteLength(record.body), 0);
      await costEvent(first.algorithmId, first.runId, CostPhase.Execution, "sqs", "receive", Math.max(1, bytes));
      await recordLambda(first.algorithmId, first.runId, CostPhase.Execution, startedAt);
    }
  }
};
