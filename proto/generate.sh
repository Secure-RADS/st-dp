#!/usr/bin/env bash
# Regenerates the checked-in gRPC stubs from proto/. Run after editing any .proto.
# Each language gets its own output tree; the .proto files stay the single source of truth.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proto_dir="$repo_root/proto"
wkt_include="/usr/include"

protoc_version="$(protoc --version)"
echo "using $protoc_version"

gen_go() {
  local module="$1" out="$2" go_import="$3"
  mkdir -p "$out"
  protoc -I "$proto_dir" -I "$wkt_include" \
    --plugin=protoc-gen-go="${PROTOC_GEN_GO:-protoc-gen-go}" \
    --plugin=protoc-gen-go-grpc="${PROTOC_GEN_GO_GRPC:-protoc-gen-go-grpc}" \
    --go_out="$out" --go_opt=module="$module" \
    --go_opt=Msce/v1/records.proto="$go_import" \
    --go_opt=Msce/v1/envelope.proto="$go_import" \
    --go-grpc_out="$out" --go-grpc_opt=module="$module" \
    --go-grpc_opt=Msce/v1/records.proto="$go_import" \
    --go-grpc_opt=Msce/v1/envelope.proto="$go_import" \
    sce/v1/records.proto sce/v1/envelope.proto
}

# sce-unit (Go server)
gen_go "sce-unit" "$repo_root/secure/sce-unit" "sce-unit/gen/scev1"

# spend-analysis (Go client)
gen_go "spend-analysis" "$repo_root/secure/samples/spend-analysis-go" "spend-analysis/gen/scev1"

# Python clients: generate at the app root so `from sce.v1 import ...` resolves with the app dir on sys.path.
for app in health-risk-python trial-eligibility-python; do
  out="$repo_root/secure/samples/$app"
  mkdir -p "$out/sce/v1"
  python -m grpc_tools.protoc -I "$proto_dir" -I "$wkt_include" \
    --python_out="$out" --grpc_python_out="$out" \
    sce/v1/records.proto sce/v1/envelope.proto
  for pkg in sce sce/v1; do
    touch "$out/$pkg/__init__.py"
  done
done
rm -f "$repo_root/secure/samples/health-risk-python"/{records,envelope}_pb2*.py \
      "$repo_root/secure/samples/trial-eligibility-python"/{records,envelope}_pb2*.py

# Seeding (TypeScript / protobuf-es)
mkdir -p "$repo_root/seeding/gen"
"${PROTOC_GEN_ES:-protoc-gen-es}" --version >/dev/null 2>&1 || true
protoc -I "$proto_dir" -I "$wkt_include" \
  --plugin=protoc-gen-es="${PROTOC_GEN_ES:-protoc-gen-es}" \
  --es_out="$repo_root/seeding/gen" --es_opt=target=ts \
  sce/v1/records.proto sce/v1/envelope.proto

# Node client (protobuf-es, JS + d.ts so the sample stays plain JS)
node_out="$repo_root/secure/samples/product-trends-node/gen"
mkdir -p "$node_out"
protoc -I "$proto_dir" -I "$wkt_include" \
  --plugin=protoc-gen-es="${PROTOC_GEN_ES:-protoc-gen-es}" \
  --es_out="$node_out" --es_opt=target=js+dts \
  sce/v1/records.proto sce/v1/envelope.proto

# Rust client (prost + tonic)
rust_out="$repo_root/secure/samples/audience-segments-rust/src/gen"
mkdir -p "$rust_out/sce/v1"
protoc -I "$proto_dir" -I "$wkt_include" \
  --plugin=protoc-gen-prost="${PROTOC_GEN_PROST:-protoc-gen-prost}" \
  --plugin=protoc-gen-tonic="${PROTOC_GEN_TONIC:-protoc-gen-tonic}" \
  --prost_out="$rust_out" \
  --tonic_out="$rust_out" \
  sce/v1/records.proto sce/v1/envelope.proto

echo "generated stubs"
