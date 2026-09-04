#!/usr/bin/env bash
set -euo pipefail

zone="${CLOUDFLARE_ZONE:-secure-rads.org}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required - source .env}"
: "${CLOUDFLARE_EMAIL:?CLOUDFLARE_EMAIL is required - source .env}"
name="${1:?usage: cloudflare-dns.sh <hostname> <target>}"
target="${2:?usage: cloudflare-dns.sh <hostname> <target>}"
name="${name%.}"
record_name="$name"
[[ "$name" == *".$zone" ]] || record_name="$name.$zone"

auth=(-H "X-Auth-Email: $CLOUDFLARE_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_TOKEN")

zone_id=$(curl -fsS "${auth[@]}" \
  "https://api.cloudflare.com/client/v4/zones?name=$zone" |
  jq -er 'if .success then .result[0].id // empty else error(.errors | tostring) end')
[ -n "$zone_id" ] || { echo "zone $zone not found" >&2; exit 1; }

curl -fsS "${auth[@]}" \
  -X POST "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"CNAME\",\"name\":\"$record_name\",\"content\":\"$target\",\"proxied\":false,\"comment\":\"SCE API Gateway - DNS-only so mTLS and TLS pins reach the origin\"}" |
  jq -e 'if .success then {id: .result.id, name: .result.name, content: .result.content, proxied: .result.proxied} else error(.errors | tostring) end'
