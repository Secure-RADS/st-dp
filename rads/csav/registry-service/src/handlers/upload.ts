import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";

const s3 = new S3Client({});
const bucket = requiredEnv("ARTIFACT_BUCKET");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Fully-trusted registry upload start: the Data Controller requests a presigned PUT URL for their docker
// image tarball at {algorithmId}/image.tar. The tarball is uploaded straight to S3, bypassing the API
// Gateway/Lambda payload limit (10MB/6MB) that would reject real images. The client then calls /register
// to record the mapping. No EIF build, KMS, or enclave attestation here.
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
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "application/x-tar" }),
    { expiresIn: 900 },
  );

  return response(200, { algorithmId, bucket, key, uploadUrl });
};
