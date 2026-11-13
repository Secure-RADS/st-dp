import { jwtEnforced, verifyAccessToken } from "./jwt.js";

// Returns null when the caller may proceed, otherwise the error to report. When jwtEnforced is false the
// baseline has no verifier, so no token is required.
export async function requireEnclaveToken(
  authorization: string | undefined,
  algorithmId: string,
): Promise<string | null> {
  if (!jwtEnforced) return null;
  if (!authorization?.startsWith("Bearer ")) return "missing bearer token";

  const validation = await verifyAccessToken(authorization.slice("Bearer ".length));
  if (!validation) return "invalid token";
  // Bind the access trail to the enclave's own algorithm so one attested enclave cannot write for another.
  if (validation.algorithmId !== algorithmId) return "token algorithm mismatch";
  return null;
}
