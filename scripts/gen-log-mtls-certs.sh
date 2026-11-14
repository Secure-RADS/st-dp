#!/usr/bin/env bash
# Generates a self-signed client cert per internal log-service producer and stores cert/key as SSM
# SecureString parameters. log-service bundles the certs into its truststore at deploy time.
set -euo pipefail

region="${AWS_REGION:?AWS_REGION is required}"
prefix="${LOG_MTLS_PARAM_PREFIX:-/secure-rads/log-service/mtls/clients}"
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

put_param() {
    aws ssm put-parameter --region "$region" --name "$1" --type SecureString \
        --value "file://$2" --overwrite >/dev/null
    echo "uploaded $1"
}

for client in registry-service execution-service result-consumer pdm-service; do
    dir="$workdir/$client"
    mkdir -p "$dir"
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 3650 -nodes \
        -keyout "$dir/client.key" -out "$dir/client.crt" -subj "/CN=$client"
    put_param "$prefix/$client/cert" "$dir/client.crt"
    put_param "$prefix/$client/key" "$dir/client.key"
done
