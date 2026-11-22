import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("RUN_ATTESTATION_TABLE");

export async function claimRunAttestation(algorithmId: string, runId: string, publicKey: Buffer): Promise<boolean> {
  try {
    const write = await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          RunId: runId,
          AlgorithmId: algorithmId,
          AttestedAt: new Date().toISOString(),
          PublicKey: publicKey.toString("base64"),
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
