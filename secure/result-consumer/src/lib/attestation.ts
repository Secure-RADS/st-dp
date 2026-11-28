import https from "node:https";
import { pinnedServerIdentity } from "@srads/common/tls";

export interface RunAttestation {
  runId: string;
  algorithmId: string;
  publicKey: string;
}

// Fetches the key verifier-service bound to this run during attestation. The response is pinned to the
// verifier leaf SPKI, the same way downstream services pin the JWKS endpoint.
export function fetchRunAttestation(
  host: string,
  pinSha256: string,
  runId: string,
): Promise<RunAttestation | undefined> {
  const checkServerIdentity = pinnedServerIdentity(pinSha256, "verifier attestation server");
  const url = new URL(`https://${host}/runs/${encodeURIComponent(runId)}`);

  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: true, checkServerIdentity }, async (res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of res) chunks.push(chunk as Buffer);
          if (res.statusCode === 404) {
            resolve(undefined);
            return;
          }
          if (res.statusCode !== 200) throw new Error(`run attestation fetch returned ${res.statusCode}`);

          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
          if (
            typeof parsed.runId !== "string" ||
            typeof parsed.algorithmId !== "string" ||
            typeof parsed.publicKey !== "string"
          ) {
            throw new Error("unexpected run attestation response shape");
          }
          resolve({ runId: parsed.runId, algorithmId: parsed.algorithmId, publicKey: parsed.publicKey });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject);
  });
}
