import { readFileSync } from "node:fs";
import { join } from "node:path";

const template = readFileSync(join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), "userdata.sh.tmpl"), "utf8");

export interface UserDataValues {
  algorithmId: string;
  costHost: string;
  kmsHost: string;
  launchEpoch: number;
  logHost: string;
  telemetryHost: string;
  pdmHost: string;
  region: string;
  runId: string;
  s3Bucket: string;
  s3Key: string;
  verifierHost: string;
  size?: number;
  webhookUrl: string;
}

export function userData(values: UserDataValues): string {
  const webhook = new URL(values.webhookUrl);
  const webhookPort = webhook.port || "443";

  const replacements: Record<string, string> = {
    AlgorithmId: values.algorithmId,
    CostHost: values.costHost,
    CPUCount: "1",
    KmsHost: values.kmsHost,
    LaunchEpoch: values.launchEpoch.toString(),
    LogHost: values.logHost,
    TelemetryHost: values.telemetryHost,
    MemoryMiB: "2048",
    PdmHost: values.pdmHost,
    Region: values.region,
    RunId: values.runId,
    S3Bucket: values.s3Bucket,
    S3Key: values.s3Key,
    Size: (values.size ?? 0).toString(),
    VerifierHost: values.verifierHost,
    WebhookAllowlist: `  - {address: "${webhook.hostname}", port: ${webhookPort}}`,
    WebhookProxy: `vsock-proxy 8006 "${webhook.hostname}" ${webhookPort} --config /etc/nitro_enclaves/vsock-proxy.yaml &`,
    WebhookURL: values.webhookUrl,
  };

  return Object.entries(replacements).reduce(
    (rendered, [name, value]) => rendered.replaceAll(`{{.${name}}}`, value),
    template,
  );
}
