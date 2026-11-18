import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("ATTESTATION_CHALLENGE_TABLE");

// Long enough for one vsock-proxied attestation round-trip, short enough that an intercepted challenge is not
// useful for long. The document itself is bound to the challenge nonce, so the TTL is the replay backstop.
export const CHALLENGE_TTL_SECONDS = 60;

export interface Challenge {
  challenge: string;
  expiresAt: string;
}

// The stored key is the challenge hash, so the table never holds the nonce an attacker would need to submit.
function challengeId(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

export async function issueChallenge(algorithmId: string, runId: string, secretHash: string): Promise<Challenge> {
  const challenge = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + CHALLENGE_TTL_SECONDS * 1000;

  const write = await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ChallengeId: challengeId(challenge),
        AlgorithmId: algorithmId,
        RunId: runId,
        SecretHash: secretHash,
        ExpiresAt: Math.floor(expiresAt / 1000),
        CreatedAt: new Date(now).toISOString(),
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

  return { challenge, expiresAt: new Date(expiresAt).toISOString() };
}

export interface ConsumedChallenge {
  secretHash: string;
}

// Atomically checks the challenge belongs to this algorithm/run, is unexpired and unused, then marks it used.
// A second call with the same challenge fails the condition, which is what rejects a replay. The old row is
// returned so /attest can compare the attestation document's user_data against the run's secret hash.
export async function consumeChallenge(
  challenge: string,
  algorithmId: string,
  runId: string,
): Promise<ConsumedChallenge | null> {
  const now = Math.floor(Date.now() / 1000);

  try {
    const write = await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { ChallengeId: challengeId(challenge) },
        UpdateExpression: "SET ConsumedAt = :consumedAt",
        ConditionExpression:
          "AlgorithmId = :algorithmId AND RunId = :runId AND ExpiresAt > :now AND attribute_not_exists(ConsumedAt)",
        ExpressionAttributeValues: {
          ":consumedAt": new Date(now * 1000).toISOString(),
          ":algorithmId": algorithmId,
          ":runId": runId,
          ":now": now,
        },
        ReturnValues: "ALL_OLD",
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
    const secretHash = write.Attributes?.SecretHash;
    return typeof secretHash === "string" ? { secretHash } : null;
  } catch (err) {
    if ((err as Error).name === "ConditionalCheckFailedException") return null;
    throw err;
  }
}
