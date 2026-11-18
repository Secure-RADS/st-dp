import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import { requiredEnv } from "@srads/common/env";
import { pinnedServerIdentity } from "@srads/common/tls";

const verifierRunsUrl = requiredEnv("VERIFIER_RUNS_URL");
const verifierPubkeySha256 = requiredEnv("VERIFIER_PUBKEY_SHA256");
const assetsDir = process.env.LAMBDA_TASK_ROOT ?? process.cwd();
const REGISTER_TIMEOUT_MS = 10_000;

export function newRunSecret(): string {
  return randomBytes(32).toString("base64url");
}

// Registers the (runId, runSecret) pair before the instance launches. The host only ever learns its own run's
// secret, so it cannot obtain a verifier challenge for another run's id.
export async function registerRunBinding(algorithmId: string, runId: string, runSecret: string): Promise<void> {
  const body = JSON.stringify({ algorithmId, runId, runSecret });
  const response = await post(body);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`verifier-service /runs returned ${response.statusCode}: ${response.body}`);
  }
}

function post(body: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      verifierRunsUrl,
      {
        method: "POST",
        cert: readFileSync(join(assetsDir, "tls", "client.crt")),
        key: readFileSync(join(assetsDir, "tls", "client.key")),
        checkServerIdentity: pinnedServerIdentity(verifierPubkeySha256, "verifier mTLS server"),
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: REGISTER_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("verifier-service /runs timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
