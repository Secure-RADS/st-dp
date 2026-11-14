import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { verifyAccessToken } from "../lib/jwt.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const algorithmTable = requiredEnv("ALGORITHM_TABLE");
const dataKeyTable = requiredEnv("DATA_KEY_TABLE");

// An attestation document is a few KiB; refuse anything that is clearly not one before sending it to KMS.
const MAX_ATTESTATION_BYTES = 64 * 1024;

interface AlgorithmRecord {
  KmsKeyArn?: string;
}

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function bearerToken(event: Parameters<APIGatewayProxyHandlerV2>[0]): string | undefined {
  const authorization = event.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

function parseAttestation(body: string | undefined): Buffer | undefined {
  try {
    const parsed: unknown = JSON.parse(body ?? "");
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { attestationDocument } = parsed as Record<string, unknown>;
    if (typeof attestationDocument !== "string" || attestationDocument.length === 0) return undefined;
    const decoded = Buffer.from(attestationDocument, "base64");
    return decoded.length > 0 && decoded.length <= MAX_ATTESTATION_BYTES ? decoded : undefined;
  } catch {
    return undefined;
  }
}

// Unwraps an algorithm's data key on the enclave's behalf. The caller proves its identity with a verifier
// access token (algorithmId from sub); the attestation document is forwarded to KMS as the Recipient, so KMS
// returns CiphertextForRecipient - encrypted to the ephemeral key inside that document - and this service
// never sees plaintext. The key policy's kms:RecipientAttestation conditions still gate the call.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  const token = bearerToken(event);
  if (!token) return jsonResponse(401, { error: "missing bearer token" });

  const validation = await verifyAccessToken(token);
  if (!validation) return jsonResponse(401, { error: "invalid token" });

  const attestationDocument = parseAttestation(event.body);
  if (!attestationDocument) {
    return jsonResponse(400, { error: "expected attestationDocument (base64) in the request body" });
  }

  const algorithmId = validation.algorithmId;
  const runId = validation.runId;

  const algorithm = await ddb.send(
    new GetCommand({
      TableName: algorithmTable,
      Key: { AlgorithmId: algorithmId },
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    algorithm.ConsumedCapacity?.CapacityUnits ?? 0,
  );
  const kmsKeyArn = (algorithm.Item as AlgorithmRecord | undefined)?.KmsKeyArn;
  if (!kmsKeyArn) {
    await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
    return jsonResponse(404, { error: "algorithm not registered" });
  }

  const keyItem = await ddb.send(
    new GetCommand({
      TableName: dataKeyTable,
      Key: { AlgorithmId: algorithmId },
      ReturnConsumedCapacity: "TOTAL",
    }),
  );
  await costEvent(
    algorithmId,
    runId,
    CostPhase.Execution,
    "dynamodb",
    "read-capacity",
    keyItem.ConsumedCapacity?.CapacityUnits ?? 0,
  );
  const wrapped = keyItem.Item?.DataKey;
  if (typeof wrapped !== "string" || wrapped.length === 0) {
    await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
    return jsonResponse(500, { error: "missing data key" });
  }

  let ciphertextForRecipient: Uint8Array | undefined;
  try {
    const result = await kms.send(
      new DecryptCommand({
        KeyId: kmsKeyArn,
        CiphertextBlob: Buffer.from(wrapped, "base64"),
        Recipient: {
          AttestationDocument: attestationDocument,
          KeyEncryptionAlgorithm: "RSAES_OAEP_SHA_256",
        },
      }),
    );
    ciphertextForRecipient = result.CiphertextForRecipient;
  } catch (error) {
    // KMS denies the call when the attestation is missing or its PCRs do not match the key policy.
    console.error("kms decrypt failed", error);
  }
  if (!ciphertextForRecipient) {
    await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
    return jsonResponse(502, { error: "kms decrypt failed" });
  }

  await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
  return jsonResponse(200, {
    ciphertextForRecipient: Buffer.from(ciphertextForRecipient).toString("base64"),
  });
};
