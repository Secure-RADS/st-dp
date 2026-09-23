import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.LAMBDA_TASK_ROOT ?? process.cwd();

// The instance runs these as heredocs; keeping them as real .py files lets them be linted and typed.
const scripts = {
  FetchRecordsScript: readFileSync(join(ROOT, "scripts/fetch-records.py"), "utf8"),
  LogEventScript: readFileSync(join(ROOT, "scripts/log-event.py"), "utf8"),
  RunResultScript: readFileSync(join(ROOT, "scripts/run-result.py"), "utf8"),
};

const template = readFileSync(join(ROOT, "userdata.sh.tmpl"), "utf8");

export interface UserDataValues {
  algorithmId: string;
  logQueueUrl: string;
  pdmUrl: string;
  region: string;
  runId: string;
  runResultsQueueUrl: string;
  s3Bucket: string;
  s3Key: string;
}

export function userData(values: UserDataValues): string {
  const replacements: Record<string, string> = {
    ...scripts,
    AlgorithmId: values.algorithmId,
    LogQueueUrl: values.logQueueUrl,
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
