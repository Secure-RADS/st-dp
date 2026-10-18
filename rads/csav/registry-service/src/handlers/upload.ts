import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CostPhase, recordRequest } from "@sce/sdk/cost";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { jsonResponse, parseBody } from "../lib/http.js";
import { algorithmRequestSchema } from "../lib/schema.js";

const s3 = new S3Client({});
const bucket = requiredEnv("ARTIFACT_BUCKET");

const PRESIGN_TTL_SECONDS = 900;

// First half of the upload: signs a PUT for the docker tarball so the bytes go straight to S3, past the
// API Gateway/Lambda payload limit. /register records the mapping once the object has landed.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  const request = algorithmRequestSchema.safeParse(parseBody(event.body));
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

  // rads has no build runId in the log timeline; cost keys the build under the algorithmId.
  await recordRequest(algorithmId, algorithmId, CostPhase.Build, startedAt);
  return jsonResponse(200, { algorithmId, bucket, key, uploadUrl });
};
