import {
  DescribeImportCommand,
  DynamoDBClient,
  ImportTableCommand,
} from "@aws-sdk/client-dynamodb";
import { requireEnv } from "./lib/env";

const bucket = requireEnv("SEED_S3_BUCKET");
const prefix = process.env.SEED_S3_PREFIX ?? "pdm-import";
const tree = process.env.SEED_TREE ?? "rads";
const dataset = requireEnv("SEED_DATASET");
const tableName = requireEnv("SEED_IMPORT_TABLE");
const region = process.env.AWS_REGION ?? "ap-southeast-2";

if (tree !== "rads" && tree !== "secure-rads") {
  console.error(`SEED_TREE must be rads or secure-rads, got ${tree}`);
  process.exit(1);
}

const ddb = new DynamoDBClient({ region });
const s3KeyPrefix = `${prefix}/${tree}/${dataset}/`;

console.log(`importing s3://${bucket}/${s3KeyPrefix} -> table ${tableName}`);

const started = await ddb.send(
  new ImportTableCommand({
    S3BucketSource: { S3Bucket: bucket, S3KeyPrefix: s3KeyPrefix },
    InputFormat: "DYNAMODB_JSON",
    InputCompressionType: "GZIP",
    TableCreationParameters: {
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: "AlgorithmId", AttributeType: "S" },
        { AttributeName: "RecordId", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "AlgorithmId", KeyType: "HASH" },
        { AttributeName: "RecordId", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    },
  }),
);

const arn = started.ImportTableDescription?.ImportArn;
if (!arn) {
  throw new Error("ImportTable returned no ImportArn");
}
console.log(`import started: ${arn}`);

for (;;) {
  const desc = await ddb.send(new DescribeImportCommand({ ImportArn: arn }));
  const info = desc.ImportTableDescription;
  const status = info?.ImportStatus;
  console.log(
    `status=${status} processed=${info?.ProcessedItemCount ?? 0} ` +
      `imported=${info?.ImportedItemCount ?? 0} errors=${info?.ErrorCount ?? 0}`,
  );
  if (status === "COMPLETED") break;
  if (status === "FAILED" || status === "CANCELLED") {
    throw new Error(`import ${status}: ${info?.FailureCode ?? ""} ${info?.FailureMessage ?? ""}`.trim());
  }
  await Bun.sleep(15_000);
}

console.log(`done: table ${tableName}`);
