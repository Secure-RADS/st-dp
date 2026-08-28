import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import type { PeerCertificate } from "node:tls";
import { createLocalJWKSet, jwtVerify } from "jose";
import { requiredEnv } from "./env.js";

const jwksUrl = new URL(requiredEnv("VERIFIER_JWKS_URL"));
const pinnedPubkeySha256 = requiredEnv("VERIFIER_JWKS_PUBKEY_SHA256").toLowerCase();

const JWT_ISSUER = "verifier-service";
const JWT_AUDIENCE = "pdm-service";

interface JsonWebKey {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg: string;
  use: string;
}

// Pin the server's SPKI hash on top of normal CA verification. Without it, anyone who could MITM this
// connection could swap in their own JWKS and mint tokens that verify locally against it - pinning the
// verifier's leaf pubkey closes that hole. (jose's createRemoteJWKSet can't do this, so the fetch is ours.)
function checkServerIdentity(_hostname: string, cert: PeerCertificate): Error | undefined {
  const spki = new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" });
  const got = createHash("sha256").update(spki).digest("hex");
  if (got !== pinnedPubkeySha256) {
    return new Error("verifier JWKS server public key does not match pinned hash");
  }
  return undefined;
}

function httpsGet(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: true, checkServerIdentity }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`JWKS fetch returned ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      })
      .on("error", reject);
  });
}

let jwksCache: Promise<JsonWebKeySet> | undefined;

interface JsonWebKeySet {
  keys: JsonWebKey[];
}

function fetchJwks(): Promise<JsonWebKeySet> {
  const fetched = (async () => {
    const parsed: unknown = JSON.parse(await httpsGet(jwksUrl));
    const keys = (parsed as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) throw new Error("unexpected JWKS response shape");
    return { keys: keys as JsonWebKey[] };
  })();
  jwksCache = fetched;
  return fetched;
}

async function verifyWithJwks(token: string, jwks: JsonWebKeySet) {
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    algorithms: ["ES256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  return payload;
}

export interface JwtValidation {
  algorithmId: string;
}

// Verifies the access token sce-unit presented, entirely locally via jose: ES256 signature against the
// pinned verifier JWKS, plus issuer, audience, and expiry (jwtVerify rejects expired tokens itself). The
// algorithmId always comes from the verified token's sub claim - never anything the client sends.
export async function verifyAccessToken(token: string): Promise<JwtValidation | null> {
  const toResult = (payload: { sub?: unknown }): JwtValidation | null =>
    typeof payload.sub === "string" && payload.sub.length > 0 ? { algorithmId: payload.sub } : null;

  try {
    return toResult(await verifyWithJwks(token, await (jwksCache ?? fetchJwks())));
  } catch (err) {
    // Unknown kid means the verifier rotated its signing key - refetch once, then give up.
    if ((err as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") return null;
  }
  try {
    return toResult(await verifyWithJwks(token, await fetchJwks()));
  } catch {
    return null;
  }
}
