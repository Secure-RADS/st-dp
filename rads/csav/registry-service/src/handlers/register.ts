import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { jsonResponse, parseBody } from "../lib/http.js";
import { emitAlgorithmRegistered, emitImageUploaded } from "../lib/log.js";
import { algorithmRequestSchema } from "../lib/schema.js";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bucket = requiredEnv("ARTIFACT_BUCKET");
const table = requiredEnv("DYNAMO_TABLE");

// Second half of the upload: /upload signs the PUT, the client sends the tarball to S3, and this verifies the
// object landed before recording AlgorithmId -> (bucket, key).
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const request = algorithmRequestSchema.safeParse(parseBody(event.body));
  if (!request.success) {
    return jsonResponse(400, { error: "expected a JSON body with a UUID 'algorithmId'" });
  }

  const { algorithmId } = request.data;
  const key = `${algorithmId}/image.tar`;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error instanceof NotFound) return jsonResponse(404, { error: "no image uploaded for this algorithmId" });
    throw error;
  }

  await emitImageUploaded(algorithmId, bucket, key);
  await ddb.send(new PutCommand({ TableName: table, Item: { AlgorithmId: algorithmId, Bucket: bucket, Key: key } }));
  await emitAlgorithmRegistered(algorithmId, bucket, key);

  return jsonResponse(200, { algorithmId, bucket, key });
};
