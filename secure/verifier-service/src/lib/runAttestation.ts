import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("RUN_ATTESTATION_TABLE");

// A run attests within minutes of launch; a day bounds the table without reopening a completed run.
const RUN_ATTESTATION_TTL_SECONDS = 24 * 60 * 60;

// First writer wins. The conditional put makes two concurrent attestations for one run race safely: one mints
// tokens, the other gets ConditionalCheckFailedException and is rejected.
export async function claimRunAttestation(algorithmId: string, runId: string): Promise<boolean> {
  try {
    const write = await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          RunId: runId,
          AlgorithmId: algorithmId,
          AttestedAt: new Date().toISOString(),
          ExpiresAt: Math.floor(Date.now() / 1000) + RUN_ATTESTATION_TTL_SECONDS,
        },
        ConditionExpression: "attribute_not_exists(RunId)",
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
    return true;
  } catch (err) {
    if ((err as Error).name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}
