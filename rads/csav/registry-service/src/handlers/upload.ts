import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { parseMultipart } from "../lib/multipart.js";
import { emitAlgorithmRegistered } from "../lib/log.js";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bucket = requiredEnv("ARTIFACT_BUCKET");
const table = requiredEnv("DYNAMO_TABLE");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Fully-trusted registry upload: a Data Controller submits a docker image tarball which is stored raw in S3 as
// {algorithmId}/image.tar and recorded as AlgorithmId -> (bucket, key) in DynamoDB. No EIF build, KMS, or
// enclave attestation here - this sibling just retains the tar for later use.
export const handler: APIGatewayProxyHandler = async (event) => {
  if (event.body === null || event.body === undefined) {
    return response(400, { error: "missing multipart body" });
  }
  const contentType = event.headers["content-type"] ?? event.headers["Content-Type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return response(415, { error: "expected multipart/form-data" });
  }
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");

  const { fields, file } = await parseMultipart(raw, contentType);
  const algorithmId = fields.algorithmId?.trim() ?? "";
  if (!UUID_RE.test(algorithmId)) {
    return response(400, { error: "missing or invalid 'algorithmId' form field (must be a UUID)" });
  }
  if (!file || file.length === 0) {
    return response(400, { error: "missing 'image' file field" });
  }

  const key = `${algorithmId}/image.tar`;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: file, ContentType: "application/x-tar" }),
  );
  await ddb.send(new PutCommand({ TableName: table, Item: { AlgorithmId: algorithmId, Bucket: bucket, Key: key } }));

  await emitAlgorithmRegistered(algorithmId, bucket, key);

  return response(200, { algorithmId, bucket, key });
};
