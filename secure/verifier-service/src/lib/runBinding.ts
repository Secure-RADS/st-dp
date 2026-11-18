import { createHash, timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("RUN_BINDING_TABLE");

// An attestation happens within minutes of launch; an hour covers boot and EIF pull without keeping a run's
// secret hash around longer than the run itself.
const RUN_BINDING_TTL_SECONDS = 60 * 60;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function registerRunBinding(algorithmId: string, runId: string, runSecret: string): Promise<void> {
  const write = await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        RunId: runId,
        AlgorithmId: algorithmId,
        SecretHash: hashSecret(runSecret),
        ExpiresAt: Math.floor(Date.now() / 1000) + RUN_BINDING_TTL_SECONDS,
        CreatedAt: new Date().toISOString(),
      },
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "write-capacity",
    write.ConsumedCapacity?.CapacityUnits ?? 0,
  );
}

// Returns the stored secret hash on a match, so /challenge can carry it forward to /attest without a second
// table read. Null covers a missing row, a different algorithm, an expired row, or a wrong secret alike.
export async function verifyRunBinding(algorithmId: string, runId: string, runSecret: string): Promise<string | null> {
  const read = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { RunId: runId },
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    read.ConsumedCapacity?.CapacityUnits ?? 0,
  );

  const item = read.Item;
  if (!item || item.AlgorithmId !== algorithmId) return null;
  if (typeof item.ExpiresAt !== "number" || item.ExpiresAt <= Math.floor(Date.now() / 1000)) return null;
  if (typeof item.SecretHash !== "string") return null;

  const expected = Buffer.from(item.SecretHash, "hex");
  const got = Buffer.from(hashSecret(runSecret), "hex");
  return expected.length === got.length && timingSafeEqual(expected, got) ? item.SecretHash : null;
}
