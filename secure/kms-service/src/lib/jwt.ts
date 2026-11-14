import { requiredEnv } from "@srads/common/env";
import { buildVerifierJwksVerifier } from "@srads/common/jwt";

// Only access tokens minted for kms-service are accepted; the algorithm comes from the verified sub.
export const verifyAccessToken = buildVerifierJwksVerifier({
  audience: "kms-service",
  pubkeySha256: requiredEnv("VERIFIER_JWKS_PUBKEY_SHA256"),
  url: new URL(requiredEnv("VERIFIER_JWKS_URL")),
});
