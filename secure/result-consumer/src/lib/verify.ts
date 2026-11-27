import { createPublicKey, verify as verifySignature } from "node:crypto";

const SIGNATURE_CONTEXT = "sce-result-v1\n";

export interface SignedResultMessage {
  runId?: unknown;
  algorithmId?: unknown;
  payload?: unknown;
  signature?: unknown;
}

export interface VerifiedResult {
  runId: string;
  algorithmId: string;
  status: string;
  output: string;
  diag: unknown;
}

interface ResultPayload {
  runId: string;
  algorithmId: string;
  status: string;
  output: string;
  diag?: unknown;
}

function isResultPayload(value: unknown): value is ResultPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.runId === "string" &&
    typeof payload.algorithmId === "string" &&
    typeof payload.status === "string" &&
    typeof payload.output === "string"
  );
}

// The enclave signs the exact payload bytes it sent, so verification never depends on JSON re-serialization.
export function verifySignedResult(
  message: SignedResultMessage,
  attestedAlgorithmId: string,
  publicKeyBase64: string,
): VerifiedResult | undefined {
  if (
    typeof message.runId !== "string" ||
    typeof message.payload !== "string" ||
    typeof message.signature !== "string"
  ) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(message.payload, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isResultPayload(payload)) return undefined;
  if (payload.runId !== message.runId || payload.algorithmId !== attestedAlgorithmId) return undefined;

  try {
    const payloadBytes = Buffer.from(message.payload, "base64");
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
    const signature = Buffer.from(message.signature, "base64");
    const signedBytes = Buffer.concat([Buffer.from(SIGNATURE_CONTEXT), payloadBytes]);
    if (!verifySignature("sha256", signedBytes, { key, dsaEncoding: "der" }, signature)) return undefined;
  } catch {
    return undefined;
  }

  return {
    runId: payload.runId,
    algorithmId: payload.algorithmId,
    status: payload.status,
    output: payload.output,
    diag: payload.diag ?? null,
  };
}
