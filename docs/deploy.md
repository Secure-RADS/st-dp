# Deploying from CI

The deploy pipeline has one entrypoint, `scripts/deploy.sh`, and a manual GitHub Actions
workflow, `.github/workflows/deploy.yml`. Both trees deploy through the same script, in dependency
order, deriving inter-service values (queue URLs and ARNs, table names, bucket names, role ARNs)
from CloudFormation stack outputs.

This covers application and infrastructure deployment. It does not seed data, build sample
algorithms, or manage Cloudflare DNS.

## Units

`scripts/deploy.sh list` prints the units in dependency order. The same order is used by the
workflow.

| Tree | Units |
| --- | --- |
| `secure` | storage, verifier-service, result-consumer, log-service, telemetry-service, cost-service, pdm-service, kms-service, csav, execution-service, registry-image, transparency-portal |
| `rads` | result-consumer, log-service, telemetry-service, cost-service, pdm-service, registry-service, execution-service, transparency-portal |

A full tree deploy runs every unit. Named units deploy only what you name; dependencies are not
deployed automatically.

Units deploy in dependency-ordered waves. Every unit in a wave runs at the same time.

## Local use

The script reads the root `.env` (see `.env.example`) like the Makefiles do. `make env` populates
the discoverable values first.

```sh
scripts/deploy.sh list
scripts/deploy.sh deploy all
scripts/deploy.sh deploy secure
scripts/deploy.sh deploy rads rads/log-service
```

## Manual workflow

Run `deploy` from the Actions tab (`workflow_dispatch`). It takes no inputs: it deploys both trees,
every unit, including the secure registry-service image.

Deploys are serialized per branch with a concurrency group. Within a run, every independent unit in
a wave deploys at the same time.

## Authentication

The workflow uses GitHub OIDC; there are no long-lived AWS keys. Set the repository variable
`AWS_DEPLOY_ROLE_ARN` to a role that trusts
`token.actions.githubusercontent.com`. Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Secure-RADS/st-dp:ref:refs/heads/*"
        }
      }
    }
  ]
}
```

The role needs CloudFormation, Lambda, S3, DynamoDB, SQS, API Gateway, CloudFront, EC2, IAM, SSM,
ACM, and CloudWatch Logs permissions. The serverless services and the CSAV stack create IAM roles,
so this is close to account admin. Run it in a dedicated account and treat it as production-adjacent.

## Repository variables

Non-secret configuration. Values left blank fall back to the root `.env` defaults, and regional
certificates are looked up by hostname in ACM.

| Variable | Purpose |
| --- | --- |
| `AWS_REGION`, `AVAILABILITY_ZONE` | target region and AZ |
| `AWS_DEPLOY_ROLE_ARN` | role assumed through OIDC |
| `RADS_EXECUTOR_AMI_ID`, `SCE_ENCLAVE_AMI_ID` | arm64 AL2023 AMIs; derived from SSM when blank |
| `CERT_ARN_RADS`, `CERT_ARN_SECURE_RADS` | us-east-1 certificates for the two portals |
| `TRANSPARENCY_DOMAIN_RADS`, `TRANSPARENCY_DOMAIN_SECURE_RADS` | portal hostnames |
| `LOG_HOST_RADS`, `LOG_HOST_SECURE_RADS` | log-service hostnames |
| `TELEMETRY_HOST_RADS`, `TELEMETRY_HOST_SECURE_RADS` | telemetry-service hostnames |
| `COST_HOST_RADS`, `COST_HOST_SECURE_RADS` | cost-service hostnames |
| `PDM_HOST`, `PDM_HOST_RADS` | PDM hostnames |
| `KMS_HOST`, `VERIFIER_HOST`, `VERIFIER_ATTEST_HOST`, `VERIFIER_URL` | secure service hostnames |
| `REGISTRY_HOST_RADS`, `EXECUTION_HOST_RADS` | rads registry and execution API hostnames |
| `VERIFIER_JWKS_URL`, `VERIFIER_JWKS_PUBKEY_SHA256` | JWKS endpoint and pin used by pdm/log/kms |
| `VERIFIER_PUBKEY_SHA256`, `VERIFIER_HOST_PUBKEY_SHA256`, `PDM_HOST_PUBKEY_SHA256`, `KMS_HOST_PUBKEY_SHA256`, `LOG_HOST_PUBKEY_SHA256`, `TELEMETRY_HOST_PUBKEY_SHA256` | TLS pins baked into the registry image |
| `GHCR_USER` | account that can pull `ghcr.io/secure-rads/nsjail-docker` |
| `CLOUDFLARE_ZONE` | Cloudflare zone |

## Repository secrets

| Secret | Purpose |
| --- | --- |
| `GHCR_TOKEN` | pull the private nsjail base image |
| `REGISTRY_TLS_CERT_B64`, `REGISTRY_TLS_KEY_B64` | base64 of the existing `secure/csav/registry-service/tls/client.{crt,key}` |
| `CSAV_SSH_KEY_B64` | base64 of `.ssh/csav-key.pem`, used to ship the registry image |
| `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_TOKEN` | Cloudflare API credentials |

`REGISTRY_TLS_CERT_B64` must be the same client certificate the verifier truststore was created
from. Generating a new certificate rotates the trust material and breaks registration until the
verifier is redeployed with the new truststore.

## Registry image

The secure registry-service image builds on a 2 vCPU Blacksmith arm64 runner, so
`--platform linux/arm64` is native and needs no QEMU. That runner holds one job at a time here, so the
image build gets the full runner. The `eif-build-base` cargo step is the heavy part; bump to
`blacksmith-4vcpu-ubuntu-2404-arm` if that build dominates. It builds `sce-unit-base` and
`eif-build-base` first, pulls the private `ghcr.io/secure-rads/nsjail-docker` base, ships the tarball
over SSH, and restarts the compose service on the CSAV host.

## Known gaps

- The TLS pins and `VERIFIER_JWKS_PUBKEY_SHA256` are captured from live endpoints after a fresh
  deploy. Set them before deploying `secure/pdm-service`, `secure/log-service`, `secure/kms-service`,
  or the registry image.
- The verifier JWT signing key must already exist at the SSM path the service reads. See
  `docs/getting-started.md`.
- The CSAV key pair and the CSAV instance must already exist before the registry image ships.
- `EXECUTION_HOST_RADS` has no default. Set it before deploying the rads tree.
