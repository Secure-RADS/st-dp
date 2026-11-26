include ../../mk/env.mk

STACK_NAME := secure-rads-execution-service-dev
REGION := $(AWS_REGION)
$(call env_require,AWS_REGION)

DEFAULT_VPC_ID = $(shell aws ec2 describe-vpcs --region $(REGION) --filters Name=is-default,Values=true \
	--query 'Vpcs[0].VpcId' --output text)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
PDM_MTLS_HOST = $(shell aws cloudformation describe-stacks --stack-name secure-rads-pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='PdmMtlsHost'].OutputValue" --output text)
API_URL = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ExecutionApiUrl'].OutputValue" --output text)

.PHONY: deploy destroy status logs env-check

deploy: env-check
	cd execution-service && bun install && bunx serverless deploy \
		--param="region=$(REGION)" \
		--param="vpcId=$(DEFAULT_VPC_ID)" \
		--param="artifactBucket=$(ARTIFACT_BUCKET)" \
		--param="algorithmTable=$(ALGORITHM_TABLE)" \
		--param="pdmMtlsHost=$(PDM_MTLS_HOST)" \
		--param="enclaveInstanceType=c6g.large"

destroy:
	cd execution-service && bunx serverless remove --param="region=$(REGION)"

status:
	cd execution-service && bunx serverless info --param="region=$(REGION)"

logs:
	aws logs tail /aws/lambda/secure-rads-execution-service-dev-run --region $(REGION) --follow

env-check:
	@$(call env_require,AWS_REGION)
	@$(call env_require,AVAILABILITY_ZONE)
	@$(call env_require,SCE_ENCLAVE_AMI_ID)
	@$(call env_require,VERIFIER_ATTEST_HOST)
	@$(call env_require,PDM_HOST)
	@$(call env_require,KMS_HOST)
	@$(call env_require,LOG_HOST_SECURE_RADS)
	@$(call env_require,TELEMETRY_HOST_SECURE_RADS)
	@$(call env_require,COST_HOST_SECURE_RADS)
