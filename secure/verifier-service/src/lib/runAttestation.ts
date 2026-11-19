import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("RUN_ATTESTATION_TABLE");

// Rows are kept permanently: a TTL would reopen the run id once it expired, and run ids are never reused.
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
