import { describe, expect, test } from "bun:test";
import type { AttestationDocument } from "./attestation.js";
import { type AttestBody, type AttestDeps, attestRequest, type RegisteredPcrs } from "./attestFlow.js";

const challenge = "A".repeat(43);
const registered: RegisteredPcrs = { PCR0: "aa", PCR1: "bb", PCR2: "cc" };

function documentWithNonce(nonce: Buffer): AttestationDocument {
  return {
    moduleId: "i-test",
    digest: "SHA384",
    timestamp: Date.now(),
    pcrs: new Map([
      [0, Buffer.from(registered.PCR0, "hex")],
      [1, Buffer.from(registered.PCR1, "hex")],
      [2, Buffer.from(registered.PCR2, "hex")],
    ]),
    nonce,
  };
}

function bodyFor(): AttestBody {
  return {
    algorithmId: "algorithm-1",
    runId: "run-1",
    attestationDocument: Buffer.from("ignored").toString("base64"),
    challenge,
  };
}

function deps(doc: AttestationDocument): AttestDeps & { consumed: Set<string> } {
  const consumed = new Set<string>();
  return {
    consumed,
    registered,
    verifyDocument: () => doc,
    consumeChallenge: async (value) => {
      if (consumed.has(value)) return false;
      consumed.add(value);
      return true;
    },
    issueTokens: async () => ({ accessToken: "access", refreshToken: "refresh" }),
  };
}

describe("attestRequest", () => {
  test("rejects a replayed attestation document", async () => {
    const doc = documentWithNonce(Buffer.from(challenge, "base64url"));
    const d = deps(doc);
    const body = bodyFor();

    const first = await attestRequest(body, d);
    expect(first.statusCode).toBe(200);

    const replay = await attestRequest(body, d);
    expect(replay.statusCode).toBe(401);
    expect(replay.body).toContain("already used");
  });

  test("rejects a document whose nonce does not match the challenge", async () => {
    const doc = documentWithNonce(Buffer.alloc(32, 1));
    const d = deps(doc);

    const result = await attestRequest(bodyFor(), d);
    expect(result.statusCode).toBe(401);
    expect(result.body).toContain("challenge mismatch");
    expect(d.consumed.size).toBe(0);
  });

  test("burns the challenge even when the PCR check fails", async () => {
    const doc = documentWithNonce(Buffer.from(challenge, "base64url"));
    doc.pcrs.set(0, Buffer.from("00", "hex"));
    const d = deps(doc);
    const body = bodyFor();

    const first = await attestRequest(body, d);
    expect(first.statusCode).toBe(401);
    expect(first.body).toContain("PCR mismatch");

    const second = await attestRequest(body, d);
    expect(second.statusCode).toBe(401);
    expect(second.body).toContain("already used");
  });

  test("rejects when the challenge store refuses the challenge", async () => {
    const doc = documentWithNonce(Buffer.from(challenge, "base64url"));
    const d = { ...deps(doc), consumeChallenge: async () => false };

    const result = await attestRequest(bodyFor(), d);
    expect(result.statusCode).toBe(401);
    expect(result.body).toContain("expired");
  });
});
