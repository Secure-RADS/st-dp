STACK_NAME := csav
KEY_NAME := csav-key
KEY_PATH := $(HOME)/.ssh/$(KEY_NAME).pem
REGION ?= ap-south-1
INSTANCE_TYPE ?= t4g.small

# Lazily resolved (only hits AWS when a target that uses it actually runs).
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)
# Live lookup, not the CF stack's Outputs - those go stale on every stop/start (no Elastic IP attached).
INSTANCE_IP = $(shell aws ec2 describe-instances --instance-ids $(INSTANCE_ID) --region $(REGION) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
SSH := ssh -i $(KEY_PATH) ec2-user@$(INSTANCE_IP)
DEFAULT_VPC_ID = $(shell aws ec2 describe-vpcs --region $(REGION) --filters Name=is-default,Values=true \
	--query 'Vpcs[0].VpcId' --output text)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)

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
	aws ec2 create-key-pair --key-name $(KEY_NAME) --region $(REGION) \
		--query 'KeyMaterial' --output text > $(KEY_PATH)
	chmod 400 $(KEY_PATH)

deploy:
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STACK_NAME) \
		--region $(REGION) \
		--capabilities CAPABILITY_IAM \
		--parameter-overrides KeyName=$(KEY_NAME) VpcId=$(DEFAULT_VPC_ID) ArtifactBucketName=$(ARTIFACT_BUCKET) AlgorithmTableName=$(ALGORITHM_TABLE) InstanceType=$(INSTANCE_TYPE)

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
