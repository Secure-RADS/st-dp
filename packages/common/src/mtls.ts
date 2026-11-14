import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import type { PeerCertificate } from "node:tls";

const mtlsHost = process.env.LOG_MTLS_HOST;
const pinnedPubkeySha256 = process.env.LOG_MTLS_PUBKEY_SHA256?.toLowerCase();
const certParam = process.env.LOG_MTLS_CERT_PARAM;
const keyParam = process.env.LOG_MTLS_KEY_PARAM;

// Baseline deployments talk to LOG_HOST directly. secure-rads sets the mTLS host and every internal
// producer then presents a client cert on the dedicated domain.
export const internalLogConfigured = Boolean(mtlsHost);

if (internalLogConfigured && (!pinnedPubkeySha256 || !certParam || !keyParam)) {
  throw new Error(
    "LOG_MTLS_PUBKEY_SHA256, LOG_MTLS_CERT_PARAM, and LOG_MTLS_KEY_PARAM are required when LOG_MTLS_HOST is set",
  );
}

function checkServerIdentity(_hostname: string, cert: PeerCertificate): Error | undefined {
  const spki = new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" });
  const got = createHash("sha256").update(spki).digest("hex");
  return got === pinnedPubkeySha256 ? undefined : new Error("log-service public key does not match pinned hash");
}

interface ClientCredentials {
  cert: string;
  key: string;
}

let credentials: Promise<ClientCredentials> | undefined;

// Fetched once per cold start from SSM SecureString so the private key is not in Lambda configuration.
function loadCredentials(): Promise<ClientCredentials> {
  if (!credentials) {
    credentials = (async () => {
      const { GetParameterCommand, SSMClient } = await import("@aws-sdk/client-ssm");
      const ssm = new SSMClient({});
      const [cert, key] = await Promise.all([
        ssm.send(new GetParameterCommand({ Name: certParam, WithDecryption: true })),
        ssm.send(new GetParameterCommand({ Name: keyParam, WithDecryption: true })),
      ]);
      if (!cert.Parameter?.Value || !key.Parameter?.Value) {
        throw new Error(`missing log-service mTLS parameter: ${certParam} / ${keyParam}`);
      }
      return { cert: cert.Parameter.Value, key: key.Parameter.Value };
    })();
  }
  return credentials;
}

export async function postInternal(path: string, body: unknown): Promise<void> {
  if (!mtlsHost) throw new Error("LOG_MTLS_HOST is not set");
  const creds = await loadCredentials();
  const data = JSON.stringify(body);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        host: mtlsHost,
        port: 443,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
        cert: creds.cert,
        key: creds.key,
        rejectUnauthorized: true,
        checkServerIdentity,
        timeout: 5_000,
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`log-service returned ${status}`));
      },
    );
    req.on("timeout", () => req.destroy(new Error("log-service request timed out")));
    req.on("error", reject);
    req.end(data);
  });
}
