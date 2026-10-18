import type { AwsService, COST_OPERATIONS, CostUnit } from "@srads/common/cost";

// Pinned list prices so a given commit's estimates are reproducible. Re-check against the AWS Price List API
// (ap-southeast-2) when this date is old. KMS is deliberately absent: the per-algorithm key is created once and
// kept, so its cost is documented as excluded rather than metered per run.
export const PRICE_REGION = "ap-southeast-2";
export const PRICE_AS_OF = "2026-10-08";

export interface PriceRule {
  unit: CostUnit;
  // USD per single billable unit, already divided down (per request, per GB-second, per instance-second).
  usdPerBillableUnit: number;
  // Byte-metered operations are charged per whole chunk of this size.
  bytesPerBillableUnit?: number;
  // Billable units consumed per chunk; DynamoDB eventually-consistent reads are 0.5 RRU per 4 KB.
  billableUnitsPerChunk?: number;
  // Per-start minimum on time-metered operations (EC2 bills a 60s minimum).
  minBillableUnits?: number;
}

type PriceTable = {
  [S in AwsService]: { [O in (typeof COST_OPERATIONS)[S][number]]: PriceRule };
};

const PER_MILLION = 1_000_000;
const PER_THOUSAND = 1_000;
const SECONDS_PER_HOUR = 3_600;
const KIB = 1024;

export const PRICES: PriceTable = {
  s3: {
    put: { unit: "request", usdPerBillableUnit: 0.0055 / PER_THOUSAND },
    list: { unit: "request", usdPerBillableUnit: 0.0055 / PER_THOUSAND },
    get: { unit: "request", usdPerBillableUnit: 0.00044 / PER_THOUSAND },
    head: { unit: "request", usdPerBillableUnit: 0.00044 / PER_THOUSAND },
  },
  dynamodb: {
    read: {
      unit: "byte",
      usdPerBillableUnit: 0.1425 / PER_MILLION,
      bytesPerBillableUnit: 4 * KIB,
      billableUnitsPerChunk: 0.5,
    },
    write: { unit: "byte", usdPerBillableUnit: 0.71 / PER_MILLION, bytesPerBillableUnit: KIB },
  },
  sqs: {
    send: { unit: "byte", usdPerBillableUnit: 0.4 / PER_MILLION, bytesPerBillableUnit: 64 * KIB },
    receive: { unit: "byte", usdPerBillableUnit: 0.4 / PER_MILLION, bytesPerBillableUnit: 64 * KIB },
    delete: { unit: "byte", usdPerBillableUnit: 0.4 / PER_MILLION, bytesPerBillableUnit: 64 * KIB },
  },
  ec2: {
    // c6g.large Linux On-Demand; the per-run executor type on both trees.
    instance: { unit: "second", usdPerBillableUnit: 0.0888 / SECONDS_PER_HOUR, minBillableUnits: 60 },
  },
  lambda: {
    invocation: { unit: "request", usdPerBillableUnit: 0.2 / PER_MILLION },
    compute: { unit: "gb-second", usdPerBillableUnit: 0.0000166667 },
  },
  apigateway: {
    request: { unit: "request", usdPerBillableUnit: 1.29 / PER_MILLION },
  },
};
