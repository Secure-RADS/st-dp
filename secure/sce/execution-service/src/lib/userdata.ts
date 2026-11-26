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
  queueUrl: string;
  size?: number;
  webhookUrl?: string;
}

const credsServer = `# Serve fresh IMDSv2 role credentials to the enclave on port 5002 so it can call SQS. The enclave has no
# IMDS access; the host holds the role. The role also lets the host send to the queue, so result integrity
# still comes from the enclave signature, not from this credential split.
python3 - <<'PYEOF' &
import json, socket, urllib.request
def get(path, token=None):
    req = urllib.request.Request("http://169.254.169.254"+path)
    if token:
        req.add_header("X-aws-ec2-metadata-token", token)
    return urllib.request.urlopen(req, timeout=5).read().decode()
s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((socket.VMADDR_CID_ANY, 5002))
s.listen(5)
while True:
    conn, _ = s.accept()
    try:
        token = urllib.request.urlopen(urllib.request.Request("http://169.254.169.254/latest/api/token",
            data=b"", method="PUT", headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"}), timeout=5).read().decode()
        role = get("/latest/meta-data/iam/security-credentials/", token)
        creds = json.loads(get("/latest/meta-data/iam/security-credentials/"+role, token))
        conn.sendall(json.dumps({
            "accessKeyId": creds["AccessKeyId"],
            "secretAccessKey": creds["SecretAccessKey"],
            "sessionToken": creds["Token"],
        }).encode())
    finally:
        conn.close()
PYEOF`;

export function userData(values: UserDataValues): string {
  const webhook = values.webhookUrl ? new URL(values.webhookUrl) : undefined;
  const webhookHost = webhook?.hostname;
  const webhookPort = webhook?.port || "443";

  const replacements: Record<string, string> = {
    AlgorithmId: values.algorithmId,
    CostHost: values.costHost,
    CPUCount: "1",
    CredsServer: webhookHost ? "" : credsServer,
    KmsHost: values.kmsHost,
    LaunchEpoch: values.launchEpoch.toString(),
    LogHost: values.logHost,
    TelemetryHost: values.telemetryHost,
    MemoryMiB: "2048",
    PdmHost: values.pdmHost,
    QueueUrl: values.queueUrl,
    Region: values.region,
    RunId: values.runId,
    S3Bucket: values.s3Bucket,
    S3Key: values.s3Key,
    Size: (values.size ?? 0).toString(),
    SqsAllowlist: webhookHost ? "" : `  - {address: "sqs.${values.region}.amazonaws.com", port: 443}`,
    SqsProxy: webhookHost
      ? ""
      : `vsock-proxy 8005 "sqs.${values.region}.amazonaws.com" 443 --config /etc/nitro_enclaves/vsock-proxy.yaml &`,
    VerifierHost: values.verifierHost,
    WebhookAllowlist: webhookHost ? `  - {address: "${webhookHost}", port: ${webhookPort}}` : "",
    WebhookProxy: webhookHost
      ? `vsock-proxy 8006 "${webhookHost}" ${webhookPort} --config /etc/nitro_enclaves/vsock-proxy.yaml &`
      : "",
    WebhookURL: values.webhookUrl ?? "",
  };

  return Object.entries(replacements).reduce(
    (rendered, [name, value]) => rendered.replaceAll(`{{.${name}}}`, value),
    template,
  );
}
