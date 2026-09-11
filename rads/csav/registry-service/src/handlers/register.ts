import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
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

// Fully-trusted registry upload finish: after the client PUTs the tarball to the presigned URL from
// /upload, this records AlgorithmId -> (bucket, key) in DynamoDB so the execution phase can find the
// image. The S3 object must already exist - a /register without a prior upload is rejected.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let algorithmId: string;
  try {
    const parsed: unknown = JSON.parse(event.body ?? "");
    algorithmId =
      typeof parsed === "object" && parsed !== null
        ? String((parsed as Record<string, unknown>).algorithmId ?? "")
        : "";
  } catch {
    return response(400, { error: "expected JSON body with algorithmId" });
  }
  if (!UUID_RE.test(algorithmId)) {
    return response(400, { error: "missing or invalid 'algorithmId' (must be a UUID)" });
  }

  const key = `${algorithmId}/image.tar`;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error instanceof NotFound) return response(404, { error: "no image uploaded for this algorithmId" });
    throw error;
  }

  await ddb.send(new PutCommand({ TableName: table, Item: { AlgorithmId: algorithmId, Bucket: bucket, Key: key } }));

  await emitAlgorithmRegistered(algorithmId, bucket, key);

  return response(200, { algorithmId, bucket, key });
};
