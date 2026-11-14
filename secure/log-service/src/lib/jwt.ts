import { requiredEnv } from "@srads/common/env";
import { buildVerifierJwksVerifier } from "@srads/common/jwt";

const jwksUrl = process.env.VERIFIER_JWKS_URL;

// Baseline deployments have no verifier and leave these unset, so ingest stays open. secure-rads sets them
// and every post-attestation enclave request must then carry an attested access token.
export const jwtEnforced = Boolean(jwksUrl);

const verifyWithVerifier = jwksUrl
  ? buildVerifierJwksVerifier({
      audience: "log-service",
      pubkeySha256: requiredEnv("VERIFIER_JWKS_PUBKEY_SHA256"),
      url: new URL(jwksUrl),
    })
  : undefined;

export function verifyAccessToken(token: string) {
  return verifyWithVerifier ? verifyWithVerifier(token) : Promise.resolve(null);
}
