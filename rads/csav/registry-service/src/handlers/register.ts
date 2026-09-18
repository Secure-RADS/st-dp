import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { S3Handler } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { emitAlgorithmRegistered } from "../lib/log.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("DYNAMO_TABLE");

const IMAGE_FILE = "image.tar";

function algorithmIdFromKey(key: string): string | undefined {
  const [algorithmId, file] = key.split("/");
  return file === IMAGE_FILE ? algorithmId : undefined;
}

// S3 ObjectCreated drives registration, so the client only calls /upload; the landed tarball is the proof of
// upload. The key prefix is the algorithmId the presign handler chose.
export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const algorithmId = algorithmIdFromKey(key);
    if (!algorithmId) continue;

    const bucket = record.s3.bucket.name;
    await ddb.send(new PutCommand({ TableName: table, Item: { AlgorithmId: algorithmId, Bucket: bucket, Key: key } }));
    await emitAlgorithmRegistered(algorithmId, bucket, key);
  }
};
