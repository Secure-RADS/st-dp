import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import { emitEvent } from "@srads/common/log";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { fetchRunAttestation } from "../lib/attestation.js";
import { type SignedResultMessage, verifySignedResult } from "../lib/verify.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_RESULTS_TABLE");
const verifierAttestHost = requiredEnv("VERIFIER_ATTEST_HOST");
const verifierAttestPin = requiredEnv("VERIFIER_ATTEST_PUBKEY_SHA256");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Receives the enclave's signed result envelope over HTTPS, verifies it against the attested run key, and
// persists the verified fields for GET /run/{runId}. A bad signature is rejected; a DynamoDB error is a 500
// so the enclave's webhook retry can try again.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  let message: SignedResultMessage;
  try {
    message = JSON.parse(event.body ?? "") as SignedResultMessage;
  } catch {
    return jsonResponse(400, { error: "invalid JSON" });
  }
  if (typeof message.runId !== "string") return jsonResponse(400, { error: "runId is required" });

  const attested = await fetchRunAttestation(verifierAttestHost, verifierAttestPin, message.runId);
  if (!attested || attested.runId !== message.runId) {
    return jsonResponse(404, { error: "run has not attested" });
  }

  const result = verifySignedResult(message, attested.algorithmId, attested.publicKey);
  if (!result) return jsonResponse(401, { error: "invalid signature" });

  const write = await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        RunId: result.runId,
        AlgorithmId: result.algorithmId,
        Status: result.status,
        Output: result.output,
        Diag: result.diag,
        ReceivedAt: new Date().toISOString(),
      },
      ReturnConsumedCapacity: "TOTAL",
    }),
  );

  await costEvent(
    result.algorithmId,
    result.runId,
    CostPhase.Execution,
    "dynamodb",
    "write-capacity",
    write.ConsumedCapacity?.CapacityUnits ?? 0,
  );
  await recordRequest(result.algorithmId, result.runId, CostPhase.Execution, startedAt);
  await emitEvent(result.algorithmId, result.runId, "result-persisted", { status: result.status });
  return jsonResponse(200, { runId: result.runId });
};
