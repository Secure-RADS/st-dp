import { createPublicKey } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { calculateJwkThumbprint, exportJWK, importPKCS8, SignJWT } from "jose";
import { requiredEnv } from "./env.js";

const ssm = new SSMClient({});
const signingKeyParam = requiredEnv("JWT_SIGNING_KEY_PARAM");

export const JWT_ISSUER = "verifier-service";
export const JWT_AUDIENCE = "pdm-service";
const JWT_ALGORITHM = "ML-DSA-87";

export interface PublicJwk {
  kty: string;
  pub: string;
  kid: string;
  alg: typeof JWT_ALGORITHM;
  use: "sig";
}

interface SigningKey {
  key: CryptoKey;
  kid: string;
  publicJwk: PublicJwk;
}

let signingKey: Promise<SigningKey> | undefined;

// Fetched once per cold start - the PEM is an SSM SecureString, not an env var, so it never lands in
// Lambda config plaintext.
function getSigningKey(): Promise<SigningKey> {
  if (!signingKey) {
    signingKey = (async () => {
      const result = await ssm.send(new GetParameterCommand({ Name: signingKeyParam, WithDecryption: true }));
      if (!result.Parameter?.Value) {
        throw new Error(`missing SSM parameter: ${signingKeyParam}`);
      }
      const pem = result.Parameter.Value;
      const key = await importPKCS8(pem, JWT_ALGORITHM);
      const jwk = { ...(await exportJWK(createPublicKey(pem))) } as { kty: string; pub: string };
      const kid = await calculateJwkThumbprint(jwk, "sha256");
      return { key, kid, publicJwk: { ...jwk, kid, alg: JWT_ALGORITHM, use: "sig" } };
    })();
  }
  return signingKey;
}

export async function getPublicJwk(): Promise<PublicJwk> {
  return (await getSigningKey()).publicJwk;
}

export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const { key, kid } = await getSigningKey();
  return new SignJWT({ jti: claims.jti })
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid })
    .setIssuer(claims.iss)
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .setJti(claims.jti)
    .sign(key);
}
