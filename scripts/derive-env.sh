#!/usr/bin/env bash
# Fills the values that can be discovered from AWS into the root .env.
# Read-only: nothing is created or modified in AWS.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
env_file="$repo_root/.env"

if [ ! -f "$env_file" ]; then
    echo "derive-env: $env_file not found. Copy .env.example to .env first." >&2
    exit 1
fi

set_key() {
    local key="$1" value="$2" current
    [ "$value" = "None" ] && value=""
    [ -n "$value" ] || return 0
    current=$(sed -n "s/^${key}=//p" "$env_file" | tail -1)
    if [ "$current" = "$value" ]; then
        printf '%-30s unchanged\n' "$key"
        return 0
    fi
    KEY="$key" VALUE="$value" awk '
        BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; found = 0 }
        $0 ~ "^" k "=" { print k "=" v; found = 1; next }
        { print }
        END { if (!found) print k "=" v }
    ' "$env_file" > "$env_file.tmp"
    mv "$env_file.tmp" "$env_file"
    chmod 600 "$env_file"
    printf '%-30s updated\n' "$key"
}

region=$(sed -n 's/^AWS_REGION=//p' "$env_file" | tail -1)
region="${region:-ap-southeast-2}"

echo "account: $(aws sts get-caller-identity --query Account --output text)"
echo "region:  $region"

ami=$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --region "$region" --query Parameter.Value --output text)
set_key RADS_EXECUTOR_AMI_ID "$ami"
set_key SCE_ENCLAVE_AMI_ID "$ami"

domain_rads=$(sed -n 's/^TRANSPARENCY_DOMAIN_RADS=//p' "$env_file" | tail -1)
domain_secure=$(sed -n 's/^TRANSPARENCY_DOMAIN_SECURE_RADS=//p' "$env_file" | tail -1)

cert_for() {
    local domain="$1"
    [ -n "$domain" ] || return 0
    aws acm list-certificates --region us-east-1 \
        --certificate-statuses ISSUED \
        --query "CertificateSummaryList[?DomainName=='$domain'].CertificateArn | [0]" \
        --output text
}

set_key CERT_ARN_RADS "$(cert_for "$domain_rads")"
set_key CERT_ARN_SECURE_RADS "$(cert_for "$domain_secure")"

pin_for() {
    local host="$1"
    [ -n "$host" ] || return 0
    timeout 15 openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null \
        | openssl x509 -pubkey -noout 2>/dev/null \
        | openssl pkey -pubin -outform DER 2>/dev/null \
        | openssl dgst -sha256 -r 2>/dev/null | cut -d' ' -f1
}

verifier_host=$(sed -n 's/^VERIFIER_HOST=//p' "$env_file" | tail -1)
verifier_attest_host=$(sed -n 's/^VERIFIER_ATTEST_HOST=//p' "$env_file" | tail -1)
pdm_host=$(sed -n 's/^PDM_HOST=//p' "$env_file" | tail -1)
log_host=$(sed -n 's/^LOG_HOST_SECURE_RADS=//p' "$env_file" | tail -1)

set_key VERIFIER_PUBKEY_SHA256 "$(pin_for "$verifier_host")"
set_key VERIFIER_HOST_PUBKEY_SHA256 "$(pin_for "$verifier_attest_host")"
set_key PDM_HOST_PUBKEY_SHA256 "$(pin_for "$pdm_host")"
set_key LOG_HOST_PUBKEY_SHA256 "$(pin_for "$log_host")"

pdm_function=$(aws lambda list-functions --region "$region" \
    --query "Functions[?starts_with(FunctionName, 'secure-rads-pdm-service')].FunctionName | [0]" \
    --output text)

if [ -n "$pdm_function" ] && [ "$pdm_function" != "None" ]; then
    jwks_sha=$(aws lambda get-function-configuration --region "$region" \
        --function-name "$pdm_function" \
        --query 'Environment.Variables.VERIFIER_JWKS_PUBKEY_SHA256' --output text)
    set_key VERIFIER_JWKS_PUBKEY_SHA256 "$jwks_sha"
fi

echo
echo "Still blank in .env (not derivable until the related stack exists or a certificate is issued):"
sed -n 's/^\([A-Z_][A-Z0-9_]*\)=$/  \1/p' "$env_file"
