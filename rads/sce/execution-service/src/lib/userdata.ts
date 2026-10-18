import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.LAMBDA_TASK_ROOT ?? process.cwd();

const template = readFileSync(join(ROOT, "userdata.sh.tmpl"), "utf8");

export interface UserDataValues {
  algorithmId: string;
  costHost: string;
  launchEpoch: number;
  logHost: string;
  pdmUrl: string;
  region: string;
  runId: string;
  runResultsQueueUrl: string;
  s3Bucket: string;
  s3Key: string;
  size?: number;
}

export function userData(values: UserDataValues): string {
  const replacements: Record<string, string> = {
    AlgorithmId: values.algorithmId,
    CostHost: values.costHost,
    LaunchEpoch: values.launchEpoch.toString(),
    LogHost: values.logHost,
    PdmUrl: values.pdmUrl,
    Region: values.region,
    RunId: values.runId,
    RunResultsQueueUrl: values.runResultsQueueUrl,
    S3Bucket: values.s3Bucket,
    S3Key: values.s3Key,
    Size: values.size?.toString() ?? "",
  };

  return Object.entries(replacements).reduce(
    (rendered, [name, value]) => rendered.replaceAll(`{{.${name}}}`, value),
    template,
  );
}
