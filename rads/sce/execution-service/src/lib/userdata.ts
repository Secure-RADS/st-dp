import { readFileSync } from "node:fs";
import { join } from "node:path";

const template = readFileSync(join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), "userdata.sh.tmpl"), "utf8");

export interface UserDataValues {
  algorithmId: string;
  logEventsQueueUrl: string;
  pdmUrl: string;
  region: string;
  runId: string;
  runResultsQueueUrl: string;
  s3Bucket: string;
  s3Key: string;
}

export function userData(values: UserDataValues): string {
  const replacements: Record<string, string> = {
    AlgorithmId: values.algorithmId,
    LogEventsQueueUrl: values.logEventsQueueUrl,
    PdmUrl: values.pdmUrl,
    Region: values.region,
    RunId: values.runId,
    RunResultsQueueUrl: values.runResultsQueueUrl,
    S3Bucket: values.s3Bucket,
    S3Key: values.s3Key,
  };

  return Object.entries(replacements).reduce(
    (rendered, [name, value]) => rendered.replaceAll(`{{.${name}}}`, value),
    template,
  );
}
