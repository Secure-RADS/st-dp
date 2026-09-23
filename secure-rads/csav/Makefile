STACK_NAME := secure-rads-csav
KEY_NAME := csav-key
KEY_PATH := $(abspath ../../.ssh/$(KEY_NAME).pem)
REGION ?= ap-southeast-2
INSTANCE_TYPE ?= t4g.small

# Lazily resolved (only hits AWS when a target that uses it actually runs).
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)
# Live lookup, not the CF stack's Outputs - those go stale on every stop/start (no Elastic IP attached).
INSTANCE_IP = $(shell aws ec2 describe-instances --instance-ids $(INSTANCE_ID) --region $(REGION) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
SSH = ssh -i $(KEY_PATH) ec2-user@$(INSTANCE_IP)
DEFAULT_VPC_ID = $(shell aws ec2 describe-vpcs --region $(REGION) --filters Name=is-default,Values=true \
	--query 'Vpcs[0].VpcId' --output text)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
# KMS key encrypting the artifact bucket; CSAV role gets kms:GenerateDataKey on it for SSE-KMS PUTs.
ARTIFACT_BUCKET_KMS_KEY_ARN = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketKmsKeyArn'].OutputValue" --output text)
# registry-service's own build-timeline events go onto the log queue; the enclave keeps its HTTP /events path.
LOG_QUEUE_URL = $(shell aws cloudformation describe-stacks --stack-name secure-rads-log-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='EventQueueUrl'].OutputValue" --output text)
LOG_QUEUE_ARN = $(shell aws cloudformation describe-stacks --stack-name secure-rads-log-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='EventQueueArn'].OutputValue" --output text)

.PHONY: build test run clean key deploy destroy up down status ssh logs

build:
	@echo "not implemented yet"

test:
	@echo "not implemented yet"

run:
	@echo "not implemented yet"

clean:
	@echo "not implemented yet"

key:
	mkdir -p $(dir $(KEY_PATH))
	aws ec2 create-key-pair --key-name $(KEY_NAME) --region $(REGION) \
		--query 'KeyMaterial' --output text > $(KEY_PATH)
	chmod 400 $(KEY_PATH)

deploy:
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STACK_NAME) \
		--region $(REGION) \
		--capabilities CAPABILITY_IAM \
		--parameter-overrides KeyName=$(KEY_NAME) VpcId=$(DEFAULT_VPC_ID) ArtifactBucketName=$(ARTIFACT_BUCKET) AlgorithmTableName=$(ALGORITHM_TABLE) ArtifactBucketKmsKeyArn=$(ARTIFACT_BUCKET_KMS_KEY_ARN) LogQueueUrl=$(LOG_QUEUE_URL) LogQueueArn=$(LOG_QUEUE_ARN) InstanceType=$(INSTANCE_TYPE)

destroy:
	aws cloudformation delete-stack --stack-name $(STACK_NAME) --region $(REGION)

status:
	aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
		--query 'Stacks[0].Outputs'

up:
	aws ec2 start-instances --region $(REGION) --instance-ids $(INSTANCE_ID)

down:
	aws ec2 stop-instances --region $(REGION) --instance-ids $(INSTANCE_ID)

ssh:
	$(SSH)

# Tail the registry-service container's logs on the instance.
logs:
	$(SSH) "cd registry-service && sudo docker compose logs -f"
