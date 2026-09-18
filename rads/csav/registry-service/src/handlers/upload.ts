import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { jsonResponse, parseBody } from "../lib/http.js";
import { uploadRequestSchema } from "../lib/schema.js";

const s3 = new S3Client({});
const bucket = requiredEnv("ARTIFACT_BUCKET");

const PRESIGN_TTL_SECONDS = 900;

// The Data Controller's only registry call: it returns a presigned PUT for the docker tarball. The tarball
// goes straight to S3 (past the API Gateway/Lambda payload limit) and the bucket notification registers it.
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

  return jsonResponse(200, { algorithmId, bucket, key, uploadUrl });
};
