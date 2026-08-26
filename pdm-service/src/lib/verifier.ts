import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import type { PeerCertificate } from "node:tls";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { requiredEnv } from "./env.js";

const CLIENT_CERT_PARAM = "/pdm-service/verifier-client-cert";
const CLIENT_KEY_PARAM = "/pdm-service/verifier-client-key";

const validateUrl = new URL(requiredEnv("VERIFIER_VALIDATE_URL"));
const pinnedPubkeySha256 = requiredEnv("VERIFIER_PUBKEY_SHA256").toLowerCase();

const ssm = new SSMClient({});

interface ClientCredentials {
  cert: string;
  key: string;
}

// Fetched once per cold start - the cert/key are SSM SecureStrings, not env vars, so they never land in
// Lambda config plaintext.
let credentials: Promise<ClientCredentials> | undefined;

async function getParameter(name: string): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  if (!result.Parameter?.Value) {
    throw new Error(`missing SSM parameter: ${name}`);
  }
  return result.Parameter.Value;
}

function getCredentials(): Promise<ClientCredentials> {
  if (!credentials) {
    credentials = Promise.all([getParameter(CLIENT_CERT_PARAM), getParameter(CLIENT_KEY_PARAM)]).then(
      ([cert, key]) => ({ cert, key }),
    );
  }
  return credentials;
}

// Pin the server's SPKI hash on top of normal CA verification - ACM certs chain publicly, so CA checks
// alone would accept any cert someone could get issued for the hostname.
function checkServerIdentity(_hostname: string, cert: PeerCertificate): Error | undefined {
  const spki = new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" });
  const got = createHash("sha256").update(spki).digest("hex");
  if (got !== pinnedPubkeySha256) {
    return new Error("verifier server public key does not match pinned hash");
  }
  return undefined;
}

export interface ValidateResult {
  active: boolean;
  algorithmId?: string;
}

export async function validateToken(accessToken: string): Promise<ValidateResult> {
  const { cert, key } = await getCredentials();
  const body = JSON.stringify({ accessToken });

  const responseBody = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      validateUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        cert,
        key,
        rejectUnauthorized: true,
        checkServerIdentity,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`verifier /validate returned ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });

  const parsed: unknown = JSON.parse(responseBody);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).active !== "boolean"
  ) {
    throw new Error("unexpected verifier /validate response shape");
  }
  const result = parsed as Record<string, unknown>;
  return {
    active: result.active as boolean,
    algorithmId: typeof result.algorithmId === "string" ? result.algorithmId : undefined,
  };
}
