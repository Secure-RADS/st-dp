import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { jsonResponse, parseBody } from "../lib/http.js";
import { emitAlgorithmRegistered } from "../lib/log.js";
import { uploadRequestSchema } from "../lib/schema.js";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bucket = requiredEnv("ARTIFACT_BUCKET");
const table = requiredEnv("DYNAMO_TABLE");

const PRESIGN_TTL_SECONDS = 900;

// One request does both: it presigns the tarball PUT and records AlgorithmId -> (bucket, key). The bytes go
// straight to S3, so the image is checked for existence where it is read (execution-service POST /run).
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const request = uploadRequestSchema.safeParse(parseBody(event.body));
  if (!request.success) {
    return jsonResponse(400, { error: "expected a JSON body with a UUID 'algorithmId'" });
  }

  const { algorithmId } = request.data;
  const key = `${algorithmId}/image.tar`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "application/x-tar" }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );

  await ddb.send(new PutCommand({ TableName: table, Item: { AlgorithmId: algorithmId, Bucket: bucket, Key: key } }));
  await emitAlgorithmRegistered(algorithmId, bucket, key);

  return jsonResponse(200, { algorithmId, bucket, key, uploadUrl });
};
