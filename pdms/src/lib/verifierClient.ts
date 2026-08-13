import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import https from "node:https";

// PDMS's own mTLS identity to verifier-service (see ../../Makefile) -
// distinct from sce-unit's cert, which authenticates the other direction.
// Baked into the deployment package at build time, not runtime-configurable
// - same convention as the rest of this repo's trust material.
const clientCert = readFileSync(new URL("../../certs/client.crt", import.meta.url));
const clientKey = readFileSync(new URL("../../certs/client.key", import.meta.url));

const introspectUrl = process.env.VERIFIER_INTROSPECT_URL!;
const pinnedPubKeySHA256 = process.env.VERIFIER_PUBKEY_SHA256!;

interface IntrospectResponse {
  active: boolean;
  algorithmId?: string;
}

// Calls verifier-service's /introspect over mTLS, with public-key pinning on
// top of the client cert (rejectUnauthorized is off since chain trust is
// replaced by pinning - matches registry-service/verifier.go's Go-side
// pattern for the same reason: PoC trust material, not a full CA setup yet).
export function introspectAccessToken(accessToken: string): Promise<IntrospectResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(introspectUrl);
    const body = JSON.stringify({ accessToken });

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        cert: clientCert,
        key: clientKey,
        rejectUnauthorized: false,
        checkServerIdentity: (_host, cert) => {
          if (!cert.pubkey) {
            return new Error("peer certificate did not include a public key");
          }
          const got = createHash("sha256").update(cert.pubkey).digest("hex");
          if (got !== pinnedPubKeySHA256) {
            return new Error(`peer pubkey pin mismatch: got ${got} want ${pinnedPubKeySHA256}`);
          }
          return undefined;
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 300) {
            reject(new Error(`verifier-service returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
