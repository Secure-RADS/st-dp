import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import type { PeerCertificate } from "node:tls";
import { createLocalJWKSet, jwtVerify } from "jose";
import { requiredEnv } from "./env.js";

interface JsonWebKeySet {
  keys: { kty: string; crv: string; x: string; y: string; kid: string; alg: string; use: string }[];
}

export interface JwtValidation {
  algorithmId: string;
}

const jwksUrl = new URL(requiredEnv("VERIFIER_JWKS_URL"));
const pinnedPubkeySha256 = requiredEnv("VERIFIER_JWKS_PUBKEY_SHA256").toLowerCase();

const JWT_ISSUER = "verifier-service";
const JWT_AUDIENCE = "pdm-service";

// SPKI pinning on top of CA verification: a MITM that could get a cert for this hostname would otherwise
// swap in its own JWKS and mint tokens PDM verifies locally.
function checkServerIdentity(_hostname: string, cert: PeerCertificate): Error | undefined {
  const spki = new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" });
  const got = createHash("sha256").update(spki).digest("hex");
  return got === pinnedPubkeySha256
    ? undefined
    : new Error("verifier JWKS server public key does not match pinned hash");
}

function httpsGet(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: true, checkServerIdentity }, async (res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of res) chunks.push(chunk as Buffer);
          if (res.statusCode !== 200) throw new Error(`JWKS fetch returned ${res.statusCode}`);
          resolve(Buffer.concat(chunks).toString("utf8"));
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject);
  });
}

let jwksCache: Promise<JsonWebKeySet> | undefined;

function fetchJwks(): Promise<JsonWebKeySet> {
  const fetched = (async () => {
    const parsed: unknown = JSON.parse(await httpsGet(jwksUrl));
    if (!Array.isArray((parsed as { keys?: unknown }).keys)) throw new Error("unexpected JWKS response shape");
    return parsed as JsonWebKeySet;
  })();
  jwksCache = fetched;
  return fetched;
}

function verifyWithJwks(token: string, jwks: JsonWebKeySet) {
  return jwtVerify(token, createLocalJWKSet(jwks), {
    algorithms: ["ES256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function subToResult(payload: { sub?: unknown }): JwtValidation | null {
  return typeof payload.sub === "string" && payload.sub.length > 0 ? { algorithmId: payload.sub } : null;
}

// jose verifies the ES256 signature, iss, aud, and exp in one call; algorithmId comes only from the
// verified token's sub - never the request.
export async function verifyAccessToken(token: string): Promise<JwtValidation | null> {
  try {
    return subToResult((await verifyWithJwks(token, await (jwksCache ?? fetchJwks()))).payload);
  } catch (err) {
    // Unknown kid means the verifier rotated its signing key - refetch the JWKS once and retry.
    if ((err as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") return null;
    try {
      return subToResult((await verifyWithJwks(token, await fetchJwks())).payload);
    } catch {
      return null;
    }
  }
}
