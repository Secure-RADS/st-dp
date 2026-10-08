// Cost metering vocabulary shared by every SCE producer. Producers emit one cost event per billable AWS
// operation they perform; ingest validates against these enums so no free-form service or operation string
// ever reaches the table. Go producers mirror this list as typed constants - keep them in sync.

export const COST_PHASES = ["build", "execution"] as const;
export type CostPhase = (typeof COST_PHASES)[number];

export const AWS_SERVICES = ["s3", "dynamodb", "sqs", "ec2", "lambda", "apigateway"] as const;
export type AwsService = (typeof AWS_SERVICES)[number];

const COST_UNITS = ["request", "byte", "second", "gb-second"] as const;
export type CostUnit = (typeof COST_UNITS)[number];

export const COST_OPERATIONS = {
  s3: ["put", "get", "head", "list"],
  dynamodb: ["read", "write"],
  sqs: ["send", "receive", "delete"],
  ec2: ["instance"],
  lambda: ["invocation", "compute"],
  apigateway: ["request"],
} as const;

type OperationsByService = typeof COST_OPERATIONS;

export type CostOperation = OperationsByService[AwsService][number];

export function isCostPhase(value: unknown): value is CostPhase {
  return typeof value === "string" && (COST_PHASES as readonly string[]).includes(value);
}

export function isAwsService(value: unknown): value is AwsService {
  return typeof value === "string" && (AWS_SERVICES as readonly string[]).includes(value);
}

export function isValidOperation(service: AwsService, operation: unknown): operation is CostOperation {
  return typeof operation === "string" && (COST_OPERATIONS[service] as readonly string[]).includes(operation);
}
