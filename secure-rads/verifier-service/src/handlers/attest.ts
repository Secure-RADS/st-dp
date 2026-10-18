import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, recordRequest } from "@sce/sdk/cost";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { type AttestationDocument, pcrHex, verifyAttestationDocument } from "../lib/attestation.js";
import { requiredEnv } from "../lib/env.js";
import { issueTokenPair } from "../lib/tokens.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const algorithmPcrTable = requiredEnv("ALGORITHM_PCR_TABLE");

interface AttestBody {
  algorithmId: string;
  runId: string;
  attestationDocument: string; // base64-encoded raw COSE_Sign1 bytes
}

function isAttestBody(body: unknown): body is AttestBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.algorithmId === "string" && typeof b.runId === "string" && typeof b.attestationDocument === "string";
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
    return { statusCode: 400, body: "expected algorithmId, runId, and attestationDocument (base64) as strings" };
  }

  try {
    const registered = await ddb.send(
      new GetCommand({ TableName: algorithmPcrTable, Key: { AlgorithmId: body.algorithmId } }),
    );
    if (!registered.Item) {
      return { statusCode: 404, body: "algorithmId not registered" };
    }

    let doc: AttestationDocument;
    try {
      doc = verifyAttestationDocument(Buffer.from(body.attestationDocument, "base64"));
    } catch (err) {
      return { statusCode: 401, body: `attestation verification failed: ${(err as Error).message}` };
    }

    const gotPcr0 = pcrHex(doc.pcrs, 0);
    const gotPcr1 = pcrHex(doc.pcrs, 1);
    const gotPcr2 = pcrHex(doc.pcrs, 2);
    if (gotPcr0 !== registered.Item.PCR0 || gotPcr1 !== registered.Item.PCR1 || gotPcr2 !== registered.Item.PCR2) {
      return { statusCode: 401, body: "PCR mismatch: enclave measurements do not match registered algorithm" };
    }

    const tokens = await issueTokenPair(body.algorithmId);
    return { statusCode: 200, body: JSON.stringify(tokens) };
  } finally {
    await recordRequest(body.algorithmId, body.runId, CostPhase.Execution, startedAt);
  }
};
