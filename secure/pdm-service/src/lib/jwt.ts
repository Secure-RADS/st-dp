import { requiredEnv } from "@srads/common/env";
import { buildVerifierJwksVerifier } from "@srads/common/jwt";

// pdm-service accepts only tokens minted for its own audience; kms-service does the same for its own.
export const verifyAccessToken = buildVerifierJwksVerifier({
  audience: "pdm-service",
  pubkeySha256: requiredEnv("VERIFIER_JWKS_PUBKEY_SHA256"),
  url: new URL(requiredEnv("VERIFIER_JWKS_URL")),
});
