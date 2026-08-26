import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSHandler, SQSRecord } from "aws-lambda";
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

// Consumes enclave run-result messages off RunResultsQueue and persists them to the RunResults table,
// where execution-service's GET /run/{runId} reads them back. The batch's records are handled concurrently.
async function persist(record: SQSRecord): Promise<void> {
  const message: RunResultMessage = JSON.parse(record.body);
  // A malformed message shouldn't poison the batch and block good ones - skip it, let it age to the DLQ.
  if (typeof message.runId !== "string") {
    console.error("skipping message with missing/invalid runId", record.messageId);
    return;
  }

  // PutItem is idempotent on RunId, so a batch retry on a DynamoDB error is safe.
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        RunId: message.runId,
        InstanceId: message.instanceId,
        AlgorithmId: message.algorithmId,
        Status: message.status,
        Output: message.output ?? "",
        Diag: message.diag ?? null,
        ReceivedAt: new Date().toISOString(),
      },
    }),
  );

  if (message.algorithmId) {
    await logEvent(message.algorithmId, message.runId, "result-persisted", { status: message.status });
  }
}

export const handler: SQSHandler = async (event) => {
  await Promise.all(event.Records.map(persist));
};
