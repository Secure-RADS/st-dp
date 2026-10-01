STACK_NAME := secure-rads-csav
KEY_NAME := csav-key
KEY_PATH := $(abspath ../../.ssh/$(KEY_NAME).pem)
REGION ?= ap-southeast-2
INSTANCE_TYPE ?= t4g.small
RENDERED_CFN := /tmp/secure-rads-csav-cloudformation.yaml

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

.PHONY: build test run clean key render-cfn deploy destroy up down status ssh logs

build:
	@echo "not implemented yet"

test:
	@echo "not implemented yet"

run:
	@echo "not implemented yet"

clean:
	rm -f $(RENDERED_CFN)

key:
	mkdir -p $(dir $(KEY_PATH))
	aws ec2 create-key-pair --key-name $(KEY_NAME) --region $(REGION) \
		--query 'KeyMaterial' --output text > $(KEY_PATH)
	chmod 400 $(KEY_PATH)

# Inject docker-compose.yml + csav-registry.service into UserData (single source of truth).
render-cfn:
	python3 scripts/render_cfn.py --out $(RENDERED_CFN)

deploy: render-cfn
	aws cloudformation deploy \
		--template-file $(RENDERED_CFN) \
		--stack-name $(STACK_NAME) \
		--region $(REGION) \
		--capabilities CAPABILITY_IAM \
		--parameter-overrides KeyName=$(KEY_NAME) VpcId=$(DEFAULT_VPC_ID) ArtifactBucketName=$(ARTIFACT_BUCKET) AlgorithmTableName=$(ALGORITHM_TABLE) ArtifactBucketKmsKeyArn=$(ARTIFACT_BUCKET_KMS_KEY_ARN) InstanceType=$(INSTANCE_TYPE)

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
