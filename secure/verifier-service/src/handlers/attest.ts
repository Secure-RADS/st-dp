import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { verifyAttestationDocument } from "../lib/attestation.js";
import { type AttestBody, attestRequest } from "../lib/attestFlow.js";
import { consumeChallenge } from "../lib/challenge.js";
import { claimRunAttestation } from "../lib/runAttestation.js";
import { issueTokenPair } from "../lib/tokens.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const algorithmPcrTable = requiredEnv("ALGORITHM_PCR_TABLE");

function isAttestBody(body: unknown): body is AttestBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.algorithmId === "string" &&
    typeof b.runId === "string" &&
    typeof b.attestationDocument === "string" &&
    typeof b.challenge === "string"
  );
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  if (!event.body) {
    return { statusCode: 400, body: "missing request body" };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "invalid JSON" };
  }

  if (!isAttestBody(body)) {
    return {
      statusCode: 400,
      body: "expected algorithmId, runId, attestationDocument (base64), and challenge as strings",
    };
  }

  try {
    const registered = await ddb.send(
      new GetCommand({
        TableName: algorithmPcrTable,
        Key: { AlgorithmId: body.algorithmId },
        ReturnConsumedCapacity: "TOTAL",
      }),
    );
    await costEvent(
      body.algorithmId,
      body.runId,
      CostPhase.Execution,
      "dynamodb",
      "read-capacity",
      registered.ConsumedCapacity?.CapacityUnits ?? 0,
    );
    if (!registered.Item) {
      return { statusCode: 404, body: "algorithmId not registered" };
    }

    return await attestRequest(body, {
      registered: registered.Item as { PCR0: string; PCR1: string; PCR2: string },
      verifyDocument: verifyAttestationDocument,
      consumeChallenge,
      claimRunAttestation,
      issueTokens: issueTokenPair,
    });
  } finally {
    await recordRequest(body.algorithmId, body.runId, CostPhase.Execution, startedAt);
  }
};
