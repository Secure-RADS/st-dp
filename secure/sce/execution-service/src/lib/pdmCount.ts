import { request as httpsRequest } from "node:https";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});
const COUNT_TIMEOUT_MS = 5000;

interface ClientMaterial {
  cert: string;
  key: string;
}

let material: Promise<ClientMaterial> | undefined;

async function getParameter(name: string): Promise<string> {
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = out.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${name} is empty`);
  }
  return value;
}

function loadClientMaterial(): Promise<ClientMaterial> {
  const certParam = process.env.PDM_MTLS_CERT_PARAM;
  const keyParam = process.env.PDM_MTLS_KEY_PARAM;
  if (!certParam || !keyParam) {
    throw new Error("PDM mTLS parameter names are not configured");
  }
  material ??= Promise.all([getParameter(certParam), getParameter(keyParam)]).then(([cert, key]) => ({
    cert,
    key,
  }));
  return material;
}

// The count lives in PDM, not in this Lambda's DynamoDB permissions. The call goes to the mTLS-only PDM
// domain with a client certificate fetched from SSM; `size` lets PDM stop early and return a lower bound.
export async function fetchAlgorithmRecordCount(
  pdmHost: string,
  algorithmId: string,
  atLeast: number,
  runId: string,
): Promise<number> {
  const { cert, key } = await loadClientMaterial();
  const query = new URLSearchParams({ algorithmId, size: String(atLeast) });

  const body = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: pdmHost,
        path: `/count?${query.toString()}`,
        method: "GET",
        cert,
        key,
        timeout: COUNT_TIMEOUT_MS,
        headers: { "x-run-id": runId },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`PDM count returned ${response.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("PDM count timed out")));
    req.on("error", reject);
    req.end();
  });

  const parsed = JSON.parse(body) as { count?: unknown };
  if (typeof parsed.count !== "number") {
    throw new Error("PDM count response missing count");
  }
  return parsed.count;
}
