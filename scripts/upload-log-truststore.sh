#!/usr/bin/env bash
# Builds the log-service mTLS truststore from the client certs in SSM, uploads it to the versioned bucket,
# and prints the S3 version ID. Pass the version to the log-service deploy as truststoreVersionId.
set -euo pipefail

region="${AWS_REGION:?AWS_REGION is required}"
bucket="${TRUSTSTORE_BUCKET:?TRUSTSTORE_BUCKET is required (log-service stack output TruststoreBucketName)}"
prefix="${LOG_MTLS_PARAM_PREFIX:-/secure-rads/log-service/mtls/clients}"
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

bundle="$workdir/truststore.pem"
: > "$bundle"
for client in registry-service execution-service result-consumer pdm-service; do
    aws ssm get-parameter --region "$region" --name "$prefix/$client/cert" \
        --with-decryption --query Parameter.Value --output text >> "$bundle"
    printf '\n' >> "$bundle"
done

version=$(aws s3api put-object --region "$region" --bucket "$bucket" --key truststore.pem \
    --body "$bundle" --content-type application/x-pem-file --query VersionId --output text)
echo "$version"
