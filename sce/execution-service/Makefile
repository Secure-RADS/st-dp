IMAGE := execution-service:latest
STACK_NAME := execution-service
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
REMOTE_DIR := /home/ec2-user/execution-service

# Lazily resolved; public IP comes from a live describe-instances call since the CF stack's Outputs go stale on stop/start.
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ExecutionServiceInstanceId'].OutputValue" --output text)
REMOTE_HOST = $(shell aws ec2 describe-instances --instance-ids $(INSTANCE_ID) --region $(REGION) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
REMOTE = ec2-user@$(REMOTE_HOST)
SSH := ssh -i $(KEY_PATH) $(REMOTE)
SCP := scp -i $(KEY_PATH)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
ENCLAVE_AMI_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='EnclaveHostAmiId'].OutputValue" --output text)
ENCLAVE_INSTANCE_TYPE ?= c6g.large
ENCLAVE_SECURITY_GROUP_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='EnclaveHostSecurityGroupId'].OutputValue" --output text)
ENCLAVE_INSTANCE_PROFILE_ARN = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='EnclaveHostInstanceProfileArn'].OutputValue" --output text)

.PHONY: build test run clean image ship remote-up remote-down logs

build:
	go build -o /tmp/execution-service .

test:
	go test ./...

run:
	AWS_REGION=$(REGION) go run .

clean:
	rm -f /tmp/execution-service

# Build the docker image locally (arm64, matches the t4g.small host).
image:
	docker build --platform linux/arm64 -t $(IMAGE) .

# Save the image + docker-compose.yml + .env (region for compose var
# substitution), scp all three to the instance.
ship: image
	docker save $(IMAGE) -o /tmp/execution-service.tar
	echo "AWS_REGION=$(REGION)" > /tmp/execution-service.env
	echo "ALGORITHM_TABLE=$(ALGORITHM_TABLE)" >> /tmp/execution-service.env
	echo "ARTIFACT_BUCKET=$(ARTIFACT_BUCKET)" >> /tmp/execution-service.env
	echo "ENCLAVE_AMI_ID=$(ENCLAVE_AMI_ID)" >> /tmp/execution-service.env
	echo "ENCLAVE_INSTANCE_TYPE=$(ENCLAVE_INSTANCE_TYPE)" >> /tmp/execution-service.env
	echo "ENCLAVE_SECURITY_GROUP_ID=$(ENCLAVE_SECURITY_GROUP_ID)" >> /tmp/execution-service.env
	echo "ENCLAVE_INSTANCE_PROFILE_ARN=$(ENCLAVE_INSTANCE_PROFILE_ARN)" >> /tmp/execution-service.env
	$(SSH) "mkdir -p $(REMOTE_DIR)"
	$(SCP) /tmp/execution-service.tar ../docker-compose.yml $(REMOTE):$(REMOTE_DIR)/
	$(SCP) /tmp/execution-service.env $(REMOTE):$(REMOTE_DIR)/.env
	rm -f /tmp/execution-service.tar /tmp/execution-service.env

# Load the shipped image and bring the compose stack up on the instance.
remote-up:
	$(SSH) "cd $(REMOTE_DIR) && docker load -i execution-service.tar && sudo docker compose up -d"

remote-down:
	$(SSH) "cd $(REMOTE_DIR) && sudo docker compose down"

# Tail docker compose logs on the instance.
logs:
	$(SSH) "cd $(REMOTE_DIR) && sudo docker compose logs -f"
