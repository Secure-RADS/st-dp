# shellcheck shell=bash
# shellcheck disable=SC2034,SC2154

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
	run make -C secure/transparency-portal install
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
	run make -C rads/transparency-portal install
	run make -C rads/transparency-portal deploy-infra
	run make -C rads/transparency-portal deploy
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
	*) die "unknown unit: $1" ;;
	esac
}
