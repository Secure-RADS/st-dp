import { timingSafeEqual } from "node:crypto";
import { type AttestationDocument, pcrHex } from "./attestation.js";

export interface AttestBody {
  algorithmId: string;
  runId: string;
  attestationDocument: string; // base64-encoded raw COSE_Sign1 bytes
  challenge: string; // nonce originally issued by POST /challenge
}

export interface RegisteredPcrs {
  PCR0: string;
  PCR1: string;
  PCR2: string;
}

export interface AttestDeps {
  registered: RegisteredPcrs;
  verifyDocument(raw: Buffer): AttestationDocument;
  consumeChallenge(challenge: string, algorithmId: string, runId: string): Promise<boolean>;
  claimRunAttestation(algorithmId: string, runId: string, publicKey: Buffer): Promise<boolean>;
  issueTokens(algorithmId: string, runId: string): Promise<unknown>;
}

export interface AttestResult {
  statusCode: number;
  body: string;
}

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function decodeChallenge(challenge: string): Buffer | null {
  if (!CHALLENGE_PATTERN.test(challenge)) return null;
  return Buffer.from(challenge, "base64url");
}

// The freshness check runs before the PCR check, and consumes the challenge, so the same document cannot be
// replayed even when its measurements are valid.
export async function attestRequest(body: AttestBody, deps: AttestDeps): Promise<AttestResult> {
  let doc: AttestationDocument;
  try {
    doc = deps.verifyDocument(Buffer.from(body.attestationDocument, "base64"));
  } catch (err) {
    return { statusCode: 401, body: `attestation verification failed: ${(err as Error).message}` };
  }

  // The public key is what result-consumer later verifies signed run results against.
  if (!doc.publicKey || doc.publicKey.length === 0) {
    return { statusCode: 401, body: "attestation document is missing a public key" };
  }

  const challenge = decodeChallenge(body.challenge);
  if (!challenge || !doc.nonce || doc.nonce.length !== challenge.length || !timingSafeEqual(doc.nonce, challenge)) {
    return {
      statusCode: 401,
      body: "challenge mismatch: attestation document was not produced for this request",
    };
  }

  if (!(await deps.consumeChallenge(body.challenge, body.algorithmId, body.runId))) {
    return { statusCode: 401, body: "challenge invalid, expired, or already used" };
  }

  const gotPcr0 = pcrHex(doc.pcrs, 0);
  const gotPcr1 = pcrHex(doc.pcrs, 1);
  const gotPcr2 = pcrHex(doc.pcrs, 2);
  if (gotPcr0 !== deps.registered.PCR0 || gotPcr1 !== deps.registered.PCR1 || gotPcr2 !== deps.registered.PCR2) {
    return { statusCode: 401, body: "PCR mismatch: enclave measurements do not match registered algorithm" };
  }

  // A run attests once. Claiming after the measurement check keeps a wrong-image request from burning a run.
  if (!(await deps.claimRunAttestation(body.algorithmId, body.runId, doc.publicKey))) {
    return { statusCode: 409, body: "run already attested" };
  }

  const tokens = await deps.issueTokens(body.algorithmId, body.runId);
  return { statusCode: 200, body: JSON.stringify(tokens) };
}
