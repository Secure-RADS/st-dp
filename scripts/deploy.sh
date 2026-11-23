#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

usage() {
	cat <<'EOF'
usage: scripts/deploy.sh <list|deploy> [tree] [unit...]

  list                      print deployable units in dependency order
  deploy [tree] [unit...]   deploy a tree (all|secure|rads) or named units

tree defaults to all. Named units must come from `list`; missing dependencies
are not deployed automatically. Units run in dependency-ordered waves, and every
unit in a wave runs at the same time.
EOF
}

die() {
	printf 'deploy: %s\n' "$*" >&2
	exit 1
}

need() {
	local key
	for key in "$@"; do
		[ -n "${!key-}" ] || die "$key is required"
	done
}

run() {
	printf '+ %s\n' "$*"
	"$@"
}

stack_output() {
	local stack="$1" key="$2" value
	value=$(aws cloudformation describe-stacks --stack-name "$stack" --region "$region" \
		--query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" --output text)
	[ -n "$value" ] && [ "$value" != None ] || die "no $key output on stack $stack"
	printf '%s' "$value"
}

cert_for() {
	local host="$1" acm_region="${2:-$region}" arn candidate
	arn=$(aws acm list-certificates --region "$acm_region" --certificate-statuses ISSUED \
		--query "CertificateSummaryList[?DomainName=='$host'].CertificateArn | [0]" --output text)
	if [ -z "$arn" ] || [ "$arn" = None ]; then
		for candidate in $(aws acm list-certificates --region "$acm_region" \
			--certificate-statuses ISSUED --query 'CertificateSummaryList[].CertificateArn' --output text); do
			if aws acm describe-certificate --region "$acm_region" --certificate-arn "$candidate" \
				--query 'Certificate.SubjectAlternativeNames' --output text | tr '\t' '\n' | grep -qx "$host"; then
				arn=$candidate
				break
			fi
		done
	fi
	[ -n "$arn" ] && [ "$arn" != None ] || die "no ISSUED ACM certificate for $host in $acm_region"
	printf '%s' "$arn"
}

sls() {
	local dir="$1"
	shift
	(
		cd "$dir"
		bun install --frozen-lockfile
		bunx serverless deploy "$@"
	)
}

ensure_env_file() {
	[ -f .env ] && return 0
	local key default value
	: >.env
	while IFS='=' read -r key default; do
		value="${!key-}"
		[ -n "$value" ] || value="$default"
		printf '%s=%s\n' "$key" "$value" >>.env
	done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=\(.*\)$/\1=\2/p' .env.example)
	chmod 600 .env
}

load_env() {
	ensure_env_file
	scripts/derive-env.sh >/dev/null
	set -a
	# shellcheck disable=SC1091
	. ./.env
	set +a
	region=${AWS_REGION:-ap-southeast-2}
}

units_secure=(
	secure/storage
	secure/verifier-service
	secure/result-consumer
	secure/log-service
	secure/telemetry-service
	secure/cost-service
	secure/pdm-service
	secure/kms-service
	secure/csav
	secure/sce/execution-service
	secure/registry-image
	secure/transparency-portal
)

units_rads=(
	rads/result-consumer
	rads/log-service
	rads/telemetry-service
	rads/cost-service
	rads/pdm-service
	rads/csav/registry-service
	rads/sce/execution-service
	rads/transparency-portal
)

declare -A DEPENDS=(
	[secure/storage]=""
	[secure/verifier-service]=""
	[secure/result-consumer]=""
	[secure/log-service]="secure/verifier-service"
	[secure/telemetry-service]=""
	[secure/cost-service]=""
	[secure/pdm-service]="secure/verifier-service"
	[secure/kms-service]="secure/storage secure/pdm-service"
	[secure/csav]="secure/storage"
	[secure/sce/execution-service]="secure/storage secure/result-consumer secure/pdm-service"
	[secure/registry-image]="secure/csav secure/kms-service"
	[secure/transparency-portal]=""
	[rads/result-consumer]=""
	[rads/log-service]=""
	[rads/telemetry-service]=""
	[rads/cost-service]=""
	[rads/pdm-service]=""
	[rads/csav/registry-service]=""
	[rads/sce/execution-service]="rads/csav/registry-service rads/result-consumer rads/pdm-service"
	[rads/transparency-portal]=""
)

describe_unit() {
	case "$1" in
	secure/storage) echo "S3 artifact bucket + algorithms table (CloudFormation)" ;;
	secure/result-consumer) echo "run-results queue + table (serverless)" ;;
	secure/log-service) echo "subject-access log API (serverless)" ;;
	secure/telemetry-service) echo "run timeline API (serverless)" ;;
	secure/cost-service) echo "cost API (serverless)" ;;
	secure/verifier-service) echo "attestation + JWKS APIs, truststore (serverless, two-pass)" ;;
	secure/pdm-service) echo "personal data API (serverless)" ;;
	secure/kms-service) echo "KMS broker API (serverless)" ;;
	secure/csav) echo "CSAV EC2 host (CloudFormation)" ;;
	secure/sce/execution-service) echo "enclave execution API (serverless)" ;;
	secure/registry-image) echo "registry-service container image build + ship" ;;
	secure/transparency-portal) echo "transparency SPA (CloudFormation + S3 + CloudFront)" ;;
	rads/result-consumer) echo "run-results queue + table (serverless)" ;;
	rads/log-service) echo "subject-access log API (serverless)" ;;
	rads/telemetry-service) echo "run timeline API (serverless)" ;;
	rads/cost-service) echo "cost API (serverless)" ;;
	rads/pdm-service) echo "personal data API (serverless)" ;;
	rads/csav/registry-service) echo "images bucket + algorithms table + registry API (serverless)" ;;
	rads/sce/execution-service) echo "executor control plane (serverless)" ;;
	rads/transparency-portal) echo "transparency SPA (CloudFormation + S3 + CloudFront)" ;;
	*) echo "unknown unit" ;;
	esac
}

unit_secure_storage() {
	run make -C secure/csav/registry-service deploy-storage
}

unit_secure_result_consumer() {
	need TELEMETRY_HOST_SECURE_RADS COST_HOST_SECURE_RADS
	sls secure/result-consumer --param="region=$region"
}

unit_secure_log_service() {
	need LOG_HOST_SECURE_RADS VERIFIER_JWKS_URL VERIFIER_JWKS_PUBKEY_SHA256
	local arn
	arn=$(cert_for "$LOG_HOST_SECURE_RADS")
	sls secure/log-service \
		--param="region=$region" \
		--param="domainName=$LOG_HOST_SECURE_RADS" \
		--param="certificateArn=$arn"
}

unit_secure_telemetry_service() {
	need TELEMETRY_HOST_SECURE_RADS
	local arn
	arn=$(cert_for "$TELEMETRY_HOST_SECURE_RADS")
	sls secure/telemetry-service \
		--param="region=$region" \
		--param="domainName=$TELEMETRY_HOST_SECURE_RADS" \
		--param="certificateArn=$arn"
}

unit_secure_cost_service() {
	need COST_HOST_SECURE_RADS
	local arn
	arn=$(cert_for "$COST_HOST_SECURE_RADS")
	sls secure/cost-service \
		--param="region=$region" \
		--param="domainName=$COST_HOST_SECURE_RADS" \
		--param="certificateArn=$arn"
}

unit_secure_verifier_service() {
	need VERIFIER_HOST VERIFIER_ATTEST_HOST VERIFIER_JWKS_URL COST_HOST_SECURE_RADS
	local cert public_cert truststore version
	cert=$(cert_for "$VERIFIER_HOST")
	public_cert=$(cert_for "$VERIFIER_ATTEST_HOST")
	sls secure/verifier-service \
		--param="region=$region" \
		--param="domainName=$VERIFIER_HOST" \
		--param="certificateArn=$cert" \
		--param="publicDomainName=$VERIFIER_ATTEST_HOST" \
		--param="publicCertificateArn=$public_cert"

	truststore=secure/csav/registry-service/tls/client.crt
	[ -f "$truststore" ] || die "$truststore is required for the verifier truststore"
	version=$(aws s3api put-object \
		--bucket "$(stack_output secure-rads-verifier-service-dev TruststoreBucketName)" \
		--key truststore.pem \
		--body "$truststore" \
		--query VersionId --output text)
	sls secure/verifier-service \
		--param="region=$region" \
		--param="domainName=$VERIFIER_HOST" \
		--param="certificateArn=$cert" \
		--param="publicDomainName=$VERIFIER_ATTEST_HOST" \
		--param="publicCertificateArn=$public_cert" \
		--param="truststoreVersionId=$version"
}

unit_secure_pdm_service() {
	need PDM_HOST LOG_HOST_SECURE_RADS COST_HOST_SECURE_RADS VERIFIER_JWKS_URL VERIFIER_JWKS_PUBKEY_SHA256
	local arn
	arn=$(cert_for "$PDM_HOST")
	sls secure/pdm-service \
		--param="region=$region" \
		--param="domainName=$PDM_HOST" \
		--param="certificateArn=$arn"
}

unit_secure_kms_service() {
	need KMS_HOST COST_HOST_SECURE_RADS VERIFIER_JWKS_URL VERIFIER_JWKS_PUBKEY_SHA256
	local arn algorithm_table data_key_table
	arn=$(cert_for "$KMS_HOST")
	algorithm_table=$(stack_output secure-rads-registry-service-storage AlgorithmTableName)
	data_key_table=$(stack_output secure-rads-pdm-service-dev DataKeyTableName)
	sls secure/kms-service \
		--param="region=$region" \
		--param="domainName=$KMS_HOST" \
		--param="certificateArn=$arn" \
		--param="algorithmTable=$algorithm_table" \
		--param="dataKeyTable=$data_key_table"
}

unit_secure_csav() {
	run make -C secure/csav deploy
}

unit_secure_execution_service() {
	run make -C secure/sce deploy
}

unit_secure_registry_image() {
	need VERIFIER_URL VERIFIER_PUBKEY_SHA256 VERIFIER_ATTEST_HOST VERIFIER_HOST_PUBKEY_SHA256 \
		PDM_HOST_PUBKEY_SHA256 LOG_HOST_PUBKEY_SHA256 KMS_HOST KMS_HOST_PUBKEY_SHA256 \
		TELEMETRY_HOST_PUBKEY_SHA256
	[ -f secure/csav/registry-service/tls/client.crt ] || die "secure/csav/registry-service/tls/client.crt is required"
	[ -f secure/csav/registry-service/tls/client.key ] || die "secure/csav/registry-service/tls/client.key is required"
	run make -C secure/csav/registry-service ship remote-up
}

unit_secure_transparency_portal() {
	run make -C secure/transparency-portal deploy-infra
	run make -C secure/transparency-portal deploy
}

unit_rads_result_consumer() {
	need TELEMETRY_HOST_RADS COST_HOST_RADS
	sls rads/result-consumer --param="region=$region"
}

unit_rads_log_service() {
	need LOG_HOST_RADS
	local arn
	arn=$(cert_for "$LOG_HOST_RADS")
	sls rads/log-service \
		--param="region=$region" \
		--param="domainName=$LOG_HOST_RADS" \
		--param="certificateArn=$arn"
}

unit_rads_telemetry_service() {
	need TELEMETRY_HOST_RADS
	local arn
	arn=$(cert_for "$TELEMETRY_HOST_RADS")
	sls rads/telemetry-service \
		--param="region=$region" \
		--param="domainName=$TELEMETRY_HOST_RADS" \
		--param="certificateArn=$arn"
}

unit_rads_cost_service() {
	need COST_HOST_RADS
	local arn
	arn=$(cert_for "$COST_HOST_RADS")
	sls rads/cost-service \
		--param="region=$region" \
		--param="domainName=$COST_HOST_RADS" \
		--param="certificateArn=$arn"
}

unit_rads_pdm_service() {
	need PDM_HOST_RADS LOG_HOST_RADS COST_HOST_RADS
	local arn
	arn=$(cert_for "$PDM_HOST_RADS")
	sls rads/pdm-service \
		--param="region=$region" \
		--param="domainName=$PDM_HOST_RADS" \
		--param="certificateArn=$arn"
}

unit_rads_registry_service() {
	need REGISTRY_HOST_RADS TELEMETRY_HOST_RADS COST_HOST_RADS
	local arn
	arn=$(cert_for "$REGISTRY_HOST_RADS")
	sls rads/csav/registry-service \
		--param="region=$region" \
		--param="domainName=$REGISTRY_HOST_RADS" \
		--param="certificateArn=$arn"
}

unit_rads_execution_service() {
	need EXECUTION_HOST_RADS PDM_HOST_RADS RADS_EXECUTOR_AMI_ID AVAILABILITY_ZONE \
		LOG_HOST_RADS TELEMETRY_HOST_RADS COST_HOST_RADS
	local arn images_bucket algorithm_table run_results_table run_results_queue_url \
		run_results_queue_arn pdm_table vpc
	arn=$(cert_for "$EXECUTION_HOST_RADS")
	vpc=$(default_vpc)
	images_bucket=$(stack_output rads-registry-service-dev ImagesBucketName)
	algorithm_table=$(stack_output rads-registry-service-dev AlgorithmsTableName)
	run_results_table=$(stack_output rads-result-consumer-dev RunResultsTableName)
	run_results_queue_url=$(stack_output rads-result-consumer-dev RunResultsQueueUrl)
	run_results_queue_arn=$(stack_output rads-result-consumer-dev RunResultsQueueArn)
	pdm_table=$(stack_output rads-pdm-service-dev PersonalDataTableName)
	sls rads/sce/execution-service \
		--param="region=$region" \
		--param="vpcId=$vpc" \
		--param="imagesBucket=$images_bucket" \
		--param="algorithmTable=$algorithm_table" \
		--param="runResultsTable=$run_results_table" \
		--param="runResultsQueueUrl=$run_results_queue_url" \
		--param="runResultsQueueArn=$run_results_queue_arn" \
		--param="pdmUrl=https://$PDM_HOST_RADS" \
		--param="pdmTable=$pdm_table" \
		--param="domainName=$EXECUTION_HOST_RADS" \
		--param="certificateArn=$arn"
}

unit_rads_transparency_portal() {
	run make -C rads/transparency-portal deploy-infra
	run make -C rads/transparency-portal deploy
}

default_vpc() {
	need AWS_REGION
	aws ec2 describe-vpcs --region "$region" --filters Name=is-default,Values=true \
		--query 'Vpcs[0].VpcId' --output text
}

deploy_unit() {
	case "$1" in
	secure/storage) unit_secure_storage ;;
	secure/result-consumer) unit_secure_result_consumer ;;
	secure/log-service) unit_secure_log_service ;;
	secure/telemetry-service) unit_secure_telemetry_service ;;
	secure/cost-service) unit_secure_cost_service ;;
	secure/verifier-service) unit_secure_verifier_service ;;
	secure/pdm-service) unit_secure_pdm_service ;;
	secure/kms-service) unit_secure_kms_service ;;
	secure/csav) unit_secure_csav ;;
	secure/sce/execution-service) unit_secure_execution_service ;;
	secure/registry-image) unit_secure_registry_image ;;
	secure/transparency-portal) unit_secure_transparency_portal ;;
	rads/result-consumer) unit_rads_result_consumer ;;
	rads/log-service) unit_rads_log_service ;;
	rads/telemetry-service) unit_rads_telemetry_service ;;
	rads/cost-service) unit_rads_cost_service ;;
	rads/pdm-service) unit_rads_pdm_service ;;
	rads/csav/registry-service) unit_rads_registry_service ;;
	rads/sce/execution-service) unit_rads_execution_service ;;
	rads/transparency-portal) unit_rads_transparency_portal ;;
	*) die "unknown unit: $1 (run 'scripts/deploy.sh list')" ;;
	esac
}

unit_done() {
	local needle="$1" unit
	[ ${#completed[@]} -eq 0 ] && return 1
	for unit in "${completed[@]}"; do
		[ "$unit" = "$needle" ] && return 0
	done
	return 1
}

unit_in_plan() {
	local needle="$1" unit
	for unit in "${plan[@]}"; do
		[ "$unit" = "$needle" ] && return 0
	done
	return 1
}

run_wave() {
	local -a wave=("$@") pids=() logs=()
	local i fail unit log
	for unit in "${wave[@]}"; do
		log=$(mktemp)
		(deploy_unit "$unit") >"$log" 2>&1 &
		pids+=("$!")
		logs+=("$log")
	done
	fail=0
	for i in "${!pids[@]}"; do
		wait "${pids[$i]}" || fail=1
	done
	for i in "${!wave[@]}"; do
		printf '==> %s\n' "${wave[$i]}"
		cat "${logs[$i]}"
		rm -f "${logs[$i]}"
	done
	[ "$fail" = 0 ] || die "one or more units failed"
}

deploy_parallel() {
	local -a remaining=("${plan[@]}") completed=() wave=() next=()
	local unit dep ok
	while [ ${#remaining[@]} -gt 0 ]; do
		wave=()
		for unit in "${remaining[@]}"; do
			ok=1
			for dep in ${DEPENDS[$unit]-}; do
				unit_in_plan "$dep" || continue
				unit_done "$dep" || {
					ok=0
					break
				}
			done
			[ "$ok" = 1 ] && wave+=("$unit")
		done
		[ ${#wave[@]} -gt 0 ] || die "dependency cycle among: ${remaining[*]}"
		run_wave "${wave[@]}"
		completed+=("${wave[@]}")
		next=()
		for unit in "${remaining[@]}"; do
			ok=1
			for dep in "${wave[@]}"; do
				[ "$unit" = "$dep" ] && ok=0
			done
			[ "$ok" = 1 ] && next+=("$unit")
		done
		remaining=("${next[@]}")
	done
}

planned_units() {
	local tree="$1"
	shift
	local -a tree_units unit want
	case "$tree" in
	all) tree_units=("${units_secure[@]}" "${units_rads[@]}") ;;
	secure) tree_units=("${units_secure[@]}") ;;
	rads) tree_units=("${units_rads[@]}") ;;
	*) die "unknown tree: $tree (all|secure|rads)" ;;
	esac

	if [ $# -eq 0 ]; then
		printf '%s\n' "${tree_units[@]}"
		return 0
	fi

	for unit in "${tree_units[@]}"; do
		for want in "$@"; do
			[ "$unit" = "$want" ] && printf '%s\n' "$unit"
		done
	done
}

cmd=${1:-}
[ -n "$cmd" ] || {
	usage
	exit 1
}
shift

positional=()
for arg in "$@"; do
	case "$arg" in
	-h | --help)
		usage
		exit 0
		;;
	-*) die "unknown option: $arg" ;;
	*) positional+=("$arg") ;;
	esac
done

if [ "$cmd" = list ] || [ "$cmd" = --list ] || [ "$cmd" = -l ]; then
	for unit in "${units_secure[@]}" "${units_rads[@]}"; do
		printf '%-34s %s\n' "$unit" "$(describe_unit "$unit")"
	done
	exit 0
fi

[ "$cmd" = deploy ] || {
	usage
	exit 1
}

tree=${positional[0]:-all}
[ ${#positional[@]} -gt 0 ] && positional=("${positional[@]:1}")
[ "$tree" = secure-rads ] && tree=secure

case "$tree" in
all | secure | rads) ;;
*) die "unknown tree: $tree (all|secure|rads)" ;;
esac

case "$tree" in
all) allowed=("${units_secure[@]}" "${units_rads[@]}") ;;
secure) allowed=("${units_secure[@]}") ;;
rads) allowed=("${units_rads[@]}") ;;
esac
for requested in "${positional[@]}"; do
	known=0
	for unit in "${allowed[@]}"; do
		[ "$requested" = "$unit" ] && known=1 && break
	done
	[ "$known" = 1 ] || die "unknown unit for tree $tree: $requested (run 'scripts/deploy.sh list')"
done

load_env

mapfile -t plan < <(planned_units "$tree" "${positional[@]}")
[ ${#plan[@]} -gt 0 ] || die "no units selected for tree $tree"

deploy_parallel
