include ../../mk/env.mk

STACK_NAME := secure-rads-execution-service-dev
REGION ?= ap-southeast-2

DEFAULT_VPC_ID = $(shell aws ec2 describe-vpcs --region $(REGION) --filters Name=is-default,Values=true \
	--query 'Vpcs[0].VpcId' --output text)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
PDM_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='PersonalDataTableName'].OutputValue" --output text)
# KMS key encrypting the artifact bucket; the enclave host role gets kms:Decrypt on it for SSE-KMS GETs.
ARTIFACT_BUCKET_KMS_KEY_ARN = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketKmsKeyArn'].OutputValue" --output text)
RUN_RESULTS_QUEUE_ARN = $(shell aws cloudformation describe-stacks --stack-name secure-rads-result-consumer-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='RunResultsQueueArn'].OutputValue" --output text)
RUN_RESULTS_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-result-consumer-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='RunResultsTableName'].OutputValue" --output text)
RUN_RESULTS_QUEUE_URL = $(shell aws cloudformation describe-stacks --stack-name secure-rads-result-consumer-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='RunResultsQueueUrl'].OutputValue" --output text)
API_URL = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ExecutionApiUrl'].OutputValue" --output text)

.PHONY: deploy destroy status logs

deploy:
	cd execution-service && bun install && bunx serverless deploy \
		--param="region=$(REGION)" \
		--param="vpcId=$(DEFAULT_VPC_ID)" \
		--param="artifactBucket=$(ARTIFACT_BUCKET)" \
		--param="artifactBucketKmsKeyArn=$(ARTIFACT_BUCKET_KMS_KEY_ARN)" \
		--param="algorithmTable=$(ALGORITHM_TABLE)" \
		--param="pdmTable=$(PDM_TABLE)" \
		--param="runResultsQueueArn=$(RUN_RESULTS_QUEUE_ARN)" \
		--param="runResultsQueueUrl=$(RUN_RESULTS_QUEUE_URL)" \
		--param="runResultsTable=$(RUN_RESULTS_TABLE)" \
		--param="enclaveInstanceType=c6g.large"

destroy:
	cd execution-service && bunx serverless remove --param="region=$(REGION)"

status:
	cd execution-service && bunx serverless info --param="region=$(REGION)"

logs:
	aws logs tail /aws/lambda/secure-rads-execution-service-dev-run --region $(REGION) --follow
