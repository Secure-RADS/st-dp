# Getting started in a new AWS account and region

This guide prepares a local environment and documents the current deployment prerequisites. It does not deploy AWS resources.

## 1. Install local prerequisites

Install [Devbox](https://www.jetify.com/docs/devbox/) and Docker Desktop or Docker Engine. Devbox provides the CLI tools, but it does not provide a running Docker daemon.

Enter the repository environment:

```sh
devbox shell
```

The environment includes AWS CLI v2, Bun, Go, Docker CLI and Compose, Make, OpenSSL, Python, SSH, curl, and jq. Confirm Docker can build Linux ARM64 images:

```sh
docker info
docker buildx inspect
```

On Linux, the current user must be allowed to access the Docker socket. On macOS and Windows, start Docker Desktop before entering the Devbox shell.

## 2. Configure AWS credentials locally

Use a dedicated IAM deployment identity, never the AWS root user. Create an access key for that identity in IAM, store the secret only in the local credential file below, and deactivate it immediately if it is exposed.

The repository ignores every file in `.aws/` except the two templates, so credentials cannot be committed accidentally.

```sh
mkdir -p .aws
cp .aws/credentials.example .aws/credentials
cp .aws/config.example .aws/config
chmod 700 .aws
chmod 600 .aws/credentials .aws/config
```

Replace the placeholder values in `.aws/credentials`. `devbox shell` exports `REGION`, `AWS_REGION`, and `AWS_DEFAULT_REGION` as `ap-southeast-2`, plus `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` so AWS CLI, Serverless Framework, and the Make targets use these local files.

Verify the target account before deploying anything:

```sh
devbox run aws-check
```

For initial PoC deployment, the identity needs administrator-level permissions. This permits all AWS actions and should be removed or replaced with a reviewed least-privilege policy after bootstrap:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
```

An organization service control policy or permissions boundary can still deny these actions.

All local configuration lives in one untracked `.env` at the repository root:

```sh
cp .env.example .env
chmod 600 .env
```

Fill in `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_TOKEN`, and optionally `CLOUDFLARE_ZONE` if it is not `secure-rads.org`. Every Makefile and `scripts/*.sh` loads that file itself, from any subdirectory, and stops with a clear message when it is missing. `devbox shell` also exports it on entry, so an existing shell only needs re-sourcing after you edit the file.

Values the deployment needs, all read from that file:

| Variable | What it is |
| --- | --- |
| `AWS_REGION` | Region every stack deploys into. |
| `AVAILABILITY_ZONE` | AZ for the rads executor and the enclave host; must be in `AWS_REGION`. |
| `RADS_EXECUTOR_AMI_ID`, `SCE_ENCLAVE_AMI_ID` | Arm64 Amazon Linux 2023 AMIs used by the two execution paths. |
| `CERT_ARN_RADS`, `CERT_ARN_SECURE_RADS` | us-east-1 ACM certificates for the two transparency portals. |
| `TRANSPARENCY_DOMAIN_RADS`, `TRANSPARENCY_DOMAIN_SECURE_RADS` | Portal hostnames on those certificates. |
| `LOG_HOST_RADS`, `LOG_HOST_SECURE_RADS`, `TELEMETRY_HOST_RADS`, `TELEMETRY_HOST_SECURE_RADS`, `COST_HOST_RADS`, `COST_HOST_SECURE_RADS` | Service hostnames each stack reports to. Log hosts carry the subject-access trail; telemetry hosts carry the diagnostic timeline. |
| `PDM_HOST`, `KMS_HOST`, `VERIFIER_HOST`, `VERIFIER_ATTEST_HOST`, `VERIFIER_URL` | PDM, KMS proxy, and verifier endpoints, including the registry-service mTLS URL. |
| `VERIFIER_PUBKEY_SHA256`, `VERIFIER_HOST_PUBKEY_SHA256`, `PDM_HOST_PUBKEY_SHA256`, `KMS_HOST_PUBKEY_SHA256`, `LOG_HOST_PUBKEY_SHA256`, `TELEMETRY_HOST_PUBKEY_SHA256` | TLS public-key pins for the enclave and internal log producers. |
| `VERIFIER_JWKS_URL`, `VERIFIER_JWKS_PUBKEY_SHA256` | Verifier key location and pin used by the PDM, KMS, and log services. |
| `CLOUDFLARE_ZONE`, `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_TOKEN` | Cloudflare zone and credentials for the DNS helper. |

Commands stop with the variable name when a required value is missing. `make env`, or `scripts/derive-env.sh` directly, fills the values that can be discovered from AWS: both AMIs from SSM, issued certificates from ACM, the TLS pins from the live endpoints, and the verifier key pin from a deployed PDM service. It only reads from AWS and patches those keys in `.env`.

The DNS helper creates DNS-only CNAME records:

```sh
scripts/cloudflare-dns.sh <hostname> <api-gateway-target>
```

## 3. Prepare the AWS account

Before deployment, prepare the selected region with:

- A default VPC and default subnet that can assign public IPv4 addresses. The EC2 Make targets discover the default VPC and the per-run enclave hosts rely on a default subnet.
- Nitro Enclaves capacity for `c6g.large` in a standard Availability Zone. Local Zones, Wavelength Zones, and Outposts do not support Nitro Enclaves.
- An EC2 key pair named `csav-key`.
- Regional ACM certificates in `ap-southeast-2` for these names:
  - `verifier.sr.secure-rads.org`
  - `verifier-attest.sr.secure-rads.org`
  - `pdm.sr.secure-rads.org`
  - `kms.sr.secure-rads.org`
  - `log.sr.secure-rads.org`
  - `cost.r.secure-rads.org`
  - `cost.sr.secure-rads.org`
- DNS-only CNAME records in Cloudflare pointing each name to its API Gateway regional domain output after its service is created. The verifier uses mTLS, and secure-rads pins the verifier, PDM, KMS, and log API Gateway certificates; cost-service uses plain TLS and is not pinned.

Create the verifier signing key before deploying the verifier service:

```sh
openssl genpkey -algorithm ML-DSA-87 -out jwt-signing-key.pem
aws ssm put-parameter \
  --name /verifier-service/jwt-signing-key \
  --type SecureString \
  --value file://jwt-signing-key.pem
rm jwt-signing-key.pem
```

Generate the registry-service mTLS client certificate locally:

```sh
make -C secure/csav/registry-service gen-client-cert
```

This file is ignored by Git and must not be shared through the repository.

## 4. Deploy in Sydney

Set the certificate ARNs before deploying. Devbox already exports `REGION=ap-southeast-2`:

```sh
export VERIFIER_CERT_ARN=<verifier-acm-certificate-arn>
export VERIFIER_ATTEST_CERT_ARN=<verifier-attest-acm-certificate-arn>
export PDM_CERT_ARN=<pdm-acm-certificate-arn>
export KMS_CERT_ARN=<kms-acm-certificate-arn>
export LOG_CERT_ARN=<log.sr-acm-certificate-arn>
export TELEMETRY_CERT_ARN=<telemetry.sr-acm-certificate-arn>
export SECURE_COST_CERT_ARN=<cost.sr-acm-certificate-arn>
export RADS_COST_CERT_ARN=<cost.r-acm-certificate-arn>
```

Generate the mTLS client certificate, then deploy verifier-service once to create its truststore bucket and run-attestation table:

```sh
make -C secure/csav/registry-service gen-client-cert
(cd secure/verifier-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=verifier.sr.secure-rads.org" \
  --param="certificateArn=$VERIFIER_CERT_ARN" \
  --param="publicDomainName=verifier-attest.sr.secure-rads.org" \
  --param="publicCertificateArn=$VERIFIER_ATTEST_CERT_ARN")
```

Deploy the result consumer next because the execution-service stack needs its queue and table. It calls verifier-service's `/runs/{runId}` at runtime, so verifier-service must be deployed first:

```sh
(cd secure/result-consumer && bun install && bunx serverless deploy --param="region=$REGION")
```

Upload the truststore, then deploy verifier-service again with its immutable S3 object version:

```sh
TRUSTSTORE_BUCKET=$(aws cloudformation describe-stacks --region "$REGION" \
  --stack-name secure-rads-verifier-service-dev \
  --query "Stacks[0].Outputs[?OutputKey=='TruststoreBucketName'].OutputValue" --output text)
TRUSTSTORE_VERSION=$(aws s3api put-object --bucket "$TRUSTSTORE_BUCKET" \
  --key truststore.pem --body secure/csav/registry-service/tls/client.crt \
  --query VersionId --output text)
(cd secure/verifier-service && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=verifier.sr.secure-rads.org" \
  --param="certificateArn=$VERIFIER_CERT_ARN" \
  --param="publicDomainName=verifier-attest.sr.secure-rads.org" \
  --param="publicCertificateArn=$VERIFIER_ATTEST_CERT_ARN" \
  --param="truststoreVersionId=$TRUSTSTORE_VERSION")
```

Create DNS-only Cloudflare CNAME records for `verifier.sr.secure-rads.org` and `verifier-attest.sr.secure-rads.org` using the CloudFormation custom-domain outputs. After DNS resolves, collect both SPKI pins:

```sh
spki_pin() {
  openssl s_client -connect "$1:443" -servername "$1" \
    -cert secure/csav/registry-service/tls/client.crt \
    -key secure/csav/registry-service/tls/client.key </dev/null 2>/dev/null |
    openssl x509 -pubkey -noout |
    openssl pkey -pubin -outform der |
    openssl dgst -sha256 -r | cut -d ' ' -f1
}

VERIFIER_PIN=$(spki_pin verifier.sr.secure-rads.org)
VERIFIER_ATTEST_PIN=$(spki_pin verifier-attest.sr.secure-rads.org)
```

Deploy PDM, log, and cost services, create their DNS-only Cloudflare CNAME records from their outputs, then collect the pins that are baked into the enclave:

```sh
VERIFIER_JWKS_URL=https://verifier-attest.sr.secure-rads.org/.well-known/jwks.json \
VERIFIER_JWKS_PUBKEY_SHA256="$VERIFIER_ATTEST_PIN" \
(cd secure/pdm-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=pdm.sr.secure-rads.org" \
  --param="certificateArn=$PDM_CERT_ARN")
(cd secure/log-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=log.sr.secure-rads.org" --param="certificateArn=$LOG_CERT_ARN")
(cd secure/telemetry-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=telemetry.sr.secure-rads.org" --param="certificateArn=$TELEMETRY_CERT_ARN")
(cd secure/cost-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=cost.sr.secure-rads.org" \
  --param="certificateArn=$SECURE_COST_CERT_ARN")
```

For the baseline tree, deploy its log, telemetry, and cost services with the `*.r.secure-rads.org` certificates:

```sh
(cd rads/log-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=log.r.secure-rads.org" --param="certificateArn=$LOG_CERT_ARN")
(cd rads/telemetry-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=telemetry.r.secure-rads.org" --param="certificateArn=$TELEMETRY_CERT_ARN")
(cd rads/cost-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=cost.r.secure-rads.org" \
  --param="certificateArn=$RADS_COST_CERT_ARN")
```

After both DNS records resolve:

```sh
PDM_PIN=$(spki_pin pdm.sr.secure-rads.org)
LOG_PIN=$(spki_pin log.sr.secure-rads.org)
TELEMETRY_PIN=$(spki_pin telemetry.sr.secure-rads.org)
```

Deploy shared storage (kms-service needs the algorithm table), then kms-service, then create its DNS-only CNAME and collect its pin:

```sh
make -C secure/csav/registry-service deploy-storage REGION="$REGION"
ALGORITHM_TABLE=$(aws cloudformation describe-stacks --region "$REGION" \
  --stack-name secure-rads-registry-service-storage \
  --query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
DATA_KEY_TABLE=$(aws cloudformation describe-stacks --region "$REGION" \
  --stack-name secure-rads-pdm-service-dev \
  --query "Stacks[0].Outputs[?OutputKey=='DataKeyTableName'].OutputValue" --output text)
VERIFIER_JWKS_URL=https://verifier-attest.sr.secure-rads.org/.well-known/jwks.json \
VERIFIER_JWKS_PUBKEY_SHA256="$VERIFIER_ATTEST_PIN" \
(cd secure/kms-service && bun install && bunx serverless deploy \
  --param="region=$REGION" \
  --param="domainName=kms.sr.secure-rads.org" \
  --param="certificateArn=$KMS_CERT_ARN" \
  --param="algorithmTable=$ALGORITHM_TABLE" \
  --param="dataKeyTable=$DATA_KEY_TABLE")
KMS_PIN=$(spki_pin kms.sr.secure-rads.org)
```

Deploy the CSAV host and serverless execution-service:

```sh
make csav-key REGION="$REGION"
make csav-deploy REGION="$REGION"
make sce-deploy REGION="$REGION"
```

Ship registry-service with the new domains and their pinned keys:

```sh
make -C secure/csav/registry-service ship remote-up REGION="$REGION" \
  VERIFIER_URL=https://verifier.sr.secure-rads.org/algorithms \
  VERIFIER_PUBKEY_SHA256="$VERIFIER_PIN" \
  VERIFIER_HOST=verifier-attest.sr.secure-rads.org \
  VERIFIER_HOST_PUBKEY_SHA256="$VERIFIER_ATTEST_PIN" \
  PDM_HOST=pdm.sr.secure-rads.org PDM_HOST_PUBKEY_SHA256="$PDM_PIN" \
  LOG_HOST=log.sr.secure-rads.org LOG_HOST_PUBKEY_SHA256="$LOG_PIN" \
  KMS_HOST=kms.sr.secure-rads.org KMS_HOST_PUBKEY_SHA256="$KMS_PIN" \
  COST_HOST=cost.sr.secure-rads.org
```

Each algorithm's key policy names the stable kms-service execution role, not the per-deployment enclave-host role. Rebuild and reseed any algorithm built before this change so its policy names kms-service. Once `make secure-rads-run` succeeds through the Lambda API, remove the legacy persistent execution-service EC2 stack:

```sh
aws cloudformation delete-stack --stack-name execution-service --region "$REGION"
```

## Credential hygiene

- Never add `.aws/credentials`, private keys, certificates, or AWS access keys to Git.
- Run `git status --ignored` before committing if credentials were ever created in this checkout.
- Deactivate and replace an IAM access key immediately after it is pasted into chat, a terminal recording, a ticket, or source control.
