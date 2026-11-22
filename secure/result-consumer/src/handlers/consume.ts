import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordLambda } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import { emitEvent } from "@srads/common/log";
import type { SQSHandler, SQSRecord } from "aws-lambda";
import { type SignedResultMessage, verifySignedResult } from "../lib/verify.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_RESULTS_TABLE");
const attestationTable = requiredEnv("RUN_ATTESTATION_TABLE");

interface AttestedRun {
  AlgorithmId?: unknown;
  PublicKey?: unknown;
}

function messageId(record: SQSRecord): { algorithmId: string; runId: string } | undefined {
  try {
    const message = JSON.parse(record.body) as SignedResultMessage;
    if (typeof message.algorithmId === "string" && typeof message.runId === "string") {
      return { algorithmId: message.algorithmId, runId: message.runId };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// Consumes enclave run-result messages off RunResultsQueue and persists them to the RunResults table,
// where execution-service's GET /run/{runId} reads them back. The batch's records are handled concurrently.
async function persist(record: SQSRecord): Promise<void> {
  let message: SignedResultMessage;
  try {
    message = JSON.parse(record.body) as SignedResultMessage;
  } catch {
    console.error("skipping message with invalid JSON", record.messageId);
    return;
  }
  // A malformed message shouldn't poison the batch and block good ones - skip it, let it age to the DLQ.
  if (typeof message.runId !== "string") {
    console.error("skipping message with missing/invalid runId", record.messageId);
    return;
  }

  const attestation = await ddb.send(
    new GetCommand({
      TableName: attestationTable,
      Key: { RunId: message.runId },
      ConsistentRead: true,
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  if (typeof message.algorithmId === "string") {
    await costEvent(
      message.algorithmId,
      message.runId,
      CostPhase.Execution,
      "dynamodb",
      "read-capacity",
      attestation.ConsumedCapacity?.CapacityUnits ?? 0,
    );
  }

  const attested = attestation.Item as AttestedRun | undefined;
  if (typeof attested?.AlgorithmId !== "string" || typeof attested.PublicKey !== "string") {
    console.error("skipping result with no attested signing key", message.runId);
    return;
  }

  const result = verifySignedResult(message, attested.AlgorithmId, attested.PublicKey);
  if (!result) {
    console.error("skipping result with invalid signature", message.runId);
    return;
  }

  const item = {
    RunId: result.runId,
    InstanceId: typeof message.instanceId === "string" ? message.instanceId : undefined,
    AlgorithmId: result.algorithmId,
    Status: result.status,
    Output: result.output,
    Diag: result.diag,
    ReceivedAt: new Date().toISOString(),
  };

  // PutItem is idempotent on RunId, so a batch retry on a DynamoDB error is safe.
  const write = await ddb.send(new PutCommand({ TableName: table, Item: item, ReturnConsumedCapacity: "TOTAL" }));

  await costEvent(
    result.algorithmId,
    result.runId,
    CostPhase.Execution,
    "dynamodb",
    "write-capacity",
    write.ConsumedCapacity?.CapacityUnits ?? 0,
  );
  await emitEvent(result.algorithmId, result.runId, "result-persisted", { status: result.status });
}

export const handler: SQSHandler = async (event) => {
  const startedAt = process.hrtime.bigint();
  const first = event.Records.map(messageId).find((ids) => ids !== undefined);
  try {
    await Promise.all(event.Records.map(persist));
  } finally {
    if (first) {
      // batchSize is 1 so this message can be charged its SQS receive and Lambda costs.
      const bytes = event.Records.reduce((total, record) => total + Buffer.byteLength(record.body), 0);
      await costEvent(first.algorithmId, first.runId, CostPhase.Execution, "sqs", "receive", Math.max(1, bytes));
      await recordLambda(first.algorithmId, first.runId, CostPhase.Execution, startedAt);
    }
  }

  if (first) await costEvent(first.algorithmId, first.runId, CostPhase.Execution, "sqs", "delete", 1);
};
