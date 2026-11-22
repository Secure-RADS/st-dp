import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("RUN_ATTESTATION_TABLE");

interface AttestedRun {
  AlgorithmId?: unknown;
  PublicKey?: unknown;
}

// result-consumer fetches this by run id to verify the enclave's result signature against the key that was
// bound to the run during attestation. Public keys are public, so this needs no auth.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  const runId = event.pathParameters?.runId;
  if (!runId) return { statusCode: 400, body: "runId is required" };

  const response = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { RunId: runId },
      ConsistentRead: true,
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  const item = response.Item as AttestedRun | undefined;
  if (typeof item?.AlgorithmId !== "string" || typeof item.PublicKey !== "string") {
    return { statusCode: 404, body: "run has not attested" };
  }

  await costEvent(
    item.AlgorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    response.ConsumedCapacity?.CapacityUnits ?? 0,
  );
  await recordRequest(item.AlgorithmId, runId, CostPhase.Execution, startedAt);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, algorithmId: item.AlgorithmId, publicKey: item.PublicKey }),
  };
};
