#!/usr/bin/env bash
# Runs on the enclave host EC2, invoked by the SSM document.
# Args:
#   $1 algorithm_id
#   $2 dc_id
#   $3 staging key (S3 key in $STAGING_BUCKET of the algorithm source)
# Environment (exported by the SSM doc):
#   STAGING_BUCKET, IMAGE_BUCKET, SIGNING_KEY, VERIFIER_URL_PARAM
# VERIFIER_URL is looked up from SSM Parameter Store using VERIFIER_URL_PARAM

set -euo pipefail

ALG_ID="$1"
DC_ID="$2"
STAGING_KEY="$3"

REGION="ap-southeast-2"
VERIFIER_URL=$(aws ssm get-parameter --region "$REGION" --name "$VERIFIER_URL_PARAM" --query Parameter.Value --output text)

WORK="/var/tmp/algorithm-build/${ALG_ID}-${DC_ID}-$(date +%s)"
mkdir -p "$WORK"
cd "$WORK"

echo ">> Fetching algorithm source from s3://$STAGING_BUCKET/$STAGING_KEY"
aws s3 cp "s3://$STAGING_BUCKET/$STAGING_KEY" algorithm.py

PROJECT=/home/ec2-user/NitroProject
echo ">> Staging enclave files"
cp -r "$PROJECT/enclave" enclave-src
cp algorithm.py enclave-src/algorithm.py

# Embed the algorithm into the image so it is part of PCR2.
# The enclave's existing import path looks for /app/algorithm.py.
cat > enclave-src/Dockerfile.algorithm <<'DOCKERFILE'
ARG KMSTOOL_BASE_IMAGE
FROM ${KMSTOOL_BASE_IMAGE} AS sdk_builder
RUN set -eu \
 && mkdir -p /staging/usr/bin /staging/usr/lib /staging/usr/lib64 \
 && cp /usr/bin/kmstool_enclave_cli /staging/usr/bin/ \
 && cp -L /usr/lib64/libnsm.so /staging/usr/lib64/libnsm.so \
 && ldd /usr/bin/kmstool_enclave_cli | awk '/=>/ {print $3}' | while read -r lib; do \
        [ -e "$lib" ] || continue; \
        case "$(basename "$lib")" in \
            libc.so.*|libm.so.*|libdl.so.*|libpthread.so.*|libgcc_s.so.*|librt.so.*|ld-*.so*|libnsl.so.*|libresolv.so.*|libutil.so.*|libcrypt.so.*) \
                ;; \
            *) \
                cp -L "$lib" /staging/usr/lib/ ;; \
        esac; \
    done

FROM public.ecr.aws/amazonlinux/amazonlinux:2
RUN yum install -y python3 python3-pip ca-certificates && yum clean all
COPY --from=sdk_builder /staging/usr/bin/   /usr/bin/
COPY --from=sdk_builder /staging/usr/lib/   /usr/lib/
COPY --from=sdk_builder /staging/usr/lib64/ /usr/lib64/
RUN ldconfig
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt
COPY nsm_client.py       /app/nsm_client.py
COPY vsock_http.py       /app/vsock_http.py
COPY enclave_server.py   /app/enclave_server.py
COPY algorithm.py        /app/algorithm.py
ENTRYPOINT ["python3", "-u", "/app/enclave_server.py"]
DOCKERFILE

# Reuse the cached kmstool builder image produced by enclave/build.sh.
KMSTOOL_IMAGE="nitro-poc-kmstool:v0.4.5"
if ! docker image inspect "$KMSTOOL_IMAGE" >/dev/null 2>&1; then
  echo "ERROR: $KMSTOOL_IMAGE not found. Run enclave/build.sh once on this host first." >&2
  exit 1
fi

echo ">> docker build (algorithm baked in)"
docker build --build-arg KMSTOOL_BASE_IMAGE="$KMSTOOL_IMAGE" \
             -t "algorithm-enclave:${ALG_ID}-${DC_ID}" \
             -f enclave-src/Dockerfile.algorithm enclave-src/

EIF="$WORK/algorithm.eif"
mkdir -p /var/tmp/nitro-cli
TMPDIR=/var/tmp/nitro-cli nitro-cli build-enclave \
  --docker-uri "algorithm-enclave:${ALG_ID}-${DC_ID}" \
  --output-file "$EIF" | tee build.log

PCR0=$(python3 -c "import re,sys;m=re.search(r'\"PCR0\"\s*:\s*\"([0-9a-fA-F]+)\"',open('build.log').read());print(m.group(1))")
PCR1=$(python3 -c "import re,sys;m=re.search(r'\"PCR1\"\s*:\s*\"([0-9a-fA-F]+)\"',open('build.log').read());print(m.group(1))")
PCR2=$(python3 -c "import re,sys;m=re.search(r'\"PCR2\"\s*:\s*\"([0-9a-fA-F]+)\"',open('build.log').read());print(m.group(1))")

echo ">> PCRs: $PCR0 / $PCR1 / $PCR2"

# KMS Sign caps the message payload at ~200KB and EIFs are larger, so we
# hash the EIF locally and pass the SHA-256 digest with message-type DIGEST.
# Verifiers reproduce the digest the same way before checking the signature.
openssl dgst -sha256 -binary "$EIF" > "$EIF.sha256"
SIG=$(aws kms sign --region "$REGION" --key-id "$SIGNING_KEY" \
    --message "fileb://$EIF.sha256" --message-type DIGEST \
    --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 \
    --query Signature --output text)

EIF_KEY="eif/${ALG_ID}/${DC_ID}/algorithm.eif"
SIG_KEY="eif/${ALG_ID}/${DC_ID}/algorithm.eif.sig"

echo ">> Uploading EIF + signature to s3://$IMAGE_BUCKET/${EIF_KEY}"
aws s3 cp "$EIF" "s3://$IMAGE_BUCKET/$EIF_KEY"
echo "$SIG" | base64 -d | aws s3 cp - "s3://$IMAGE_BUCKET/$SIG_KEY"

echo ">> Registering with Verifier: $VERIFIER_URL"
REG_BODY=$(printf '{"algorithm_id":"%s","dc_id":"%s","pcr0":"%s","pcr1":"%s","pcr2":"%s"}' \
    "$ALG_ID" "$DC_ID" "$PCR0" "$PCR1" "$PCR2")
curl -sS -X POST -H "Content-Type: application/json" -d "$REG_BODY" "$VERIFIER_URL" || true

echo ">> Done. EIF=s3://$IMAGE_BUCKET/$EIF_KEY  SIG=s3://$IMAGE_BUCKET/$SIG_KEY"
