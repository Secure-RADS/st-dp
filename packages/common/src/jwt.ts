import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import type { PeerCertificate } from "node:tls";
import { createLocalJWKSet, jwtVerify } from "jose";

interface JsonWebKeySet {
  keys: { kty: string; pub: string; kid: string; alg: string; use: string }[];
}

export interface JwtValidation {
  algorithmId: string;
}

const JWT_ISSUER = "verifier-service";
const JWT_ALGORITHM = "ML-DSA-87";

export interface VerifierJwksOptions {
  // Varies by service: an access token is accepted only by the audience it was minted for.
  audience: string;
  // SPKI pin on top of CA verification: a MITM that could get a cert for this hostname would otherwise
  // swap in its own JWKS and mint tokens this service verifies locally.
  pubkeySha256: string;
  url: URL;
}

// buildVerifierJwksVerifier returns a verifyAccessToken function bound to one verifier JWKS endpoint and
// audience. The JWKS is cached per warm instance and refetched once on an unknown kid (signing-key rotation).
export function buildVerifierJwksVerifier(
  options: VerifierJwksOptions,
): (token: string) => Promise<JwtValidation | null> {
  const pinnedPubkeySha256 = options.pubkeySha256.toLowerCase();

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
      const parsed: unknown = JSON.parse(await httpsGet(options.url));
      if (!Array.isArray((parsed as { keys?: unknown }).keys)) throw new Error("unexpected JWKS response shape");
      return parsed as JsonWebKeySet;
    })();
    jwksCache = fetched;
    return fetched;
  }

  function verifyWithJwks(token: string, jwks: JsonWebKeySet) {
    return jwtVerify(token, createLocalJWKSet(jwks), {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: options.audience,
    });
  }

  function subToResult(payload: { sub?: unknown }): JwtValidation | null {
    return typeof payload.sub === "string" && payload.sub.length > 0 ? { algorithmId: payload.sub } : null;
  }

  // jose verifies the ML-DSA-87 signature, iss, aud, and exp in one call; algorithmId comes only from the
  // verified token's sub - never the request.
  return async (token) => {
    try {
      return subToResult((await verifyWithJwks(token, await (jwksCache ?? fetchJwks()))).payload);
    } catch (err) {
      if ((err as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") return null;
      try {
        return subToResult((await verifyWithJwks(token, await fetchJwks())).payload);
      } catch {
        return null;
      }
    }
  };
}
