STACK_NAME := csav
KEY_NAME := csav-key
KEY_PATH := $(HOME)/.ssh/$(KEY_NAME).pem
REGION ?= ap-south-1

# Lazily resolved (only hits AWS when a target that uses it actually runs).
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)
INSTANCE_IP = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstancePublicIp'].OutputValue" --output text)
SSH := ssh -i $(KEY_PATH) ec2-user@$(INSTANCE_IP)
DEFAULT_VPC_ID = $(shell aws ec2 describe-vpcs --region $(REGION) --filters Name=is-default,Values=true \
	--query 'Vpcs[0].VpcId' --output text)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)

.PHONY: build test run clean key deploy destroy up down status ssh

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
		--parameter-overrides KeyName=$(KEY_NAME) VpcId=$(DEFAULT_VPC_ID) ArtifactBucketName=$(ARTIFACT_BUCKET)

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
