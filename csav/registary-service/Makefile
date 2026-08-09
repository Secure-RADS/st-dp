IMAGE := registry-service:latest
STACK_NAME := csav
STORAGE_STACK_NAME := registry-service-storage
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
REMOTE_DIR := /home/ec2-user/registry-service

# Lazily resolved (only hits AWS when a target that uses it actually runs).
# The public IP has to come from a live `describe-instances` call, not the
# CloudFormation stack's Outputs - those are a static snapshot from the last
# deploy, and the instance's public IP (no Elastic IP attached) changes on
# every stop/start.
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)
REMOTE_HOST = $(shell aws ec2 describe-instances --instance-ids $(INSTANCE_ID) --region $(REGION) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
REMOTE = ec2-user@$(REMOTE_HOST)
SSH := ssh -i $(KEY_PATH) $(REMOTE)
SCP := scp -i $(KEY_PATH)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)

.PHONY: build test run clean sce-unit-base image ship remote-up remote-down logs deploy-storage destroy-storage upload

build:
	go build -o /tmp/registry-service .

test:
	go test ./...

run:
	AWS_REGION=$(REGION) ARTIFACT_BUCKET=$(ARTIFACT_BUCKET) go run .

clean:
	rm -f /tmp/registry-service

# Pre-built asset baked into the app image at build time (see Dockerfile) -
# rebuild only when sce-unit itself changes, not per upload. nsjail comes
# from ghcr.io/prdai/nsjail-docker (rebuilt weekly there) instead.
sce-unit-base:
	docker build --platform linux/arm64 -t sce-unit-base:latest ../../sce-unit

# Build the docker image locally (arm64, matches the t4g.nano host).
image: sce-unit-base
	docker pull --platform linux/arm64 ghcr.io/prdai/nsjail-docker:latest
	docker build --platform linux/arm64 -t $(IMAGE) .

# Save the image + docker-compose.yml + .env (bucket/region for compose var
# substitution), scp all three to the instance.
ship: image
	docker save $(IMAGE) -o /tmp/registry-service.tar
	echo "ARTIFACT_BUCKET=$(ARTIFACT_BUCKET)" > /tmp/registry-service.env
	echo "AWS_REGION=$(REGION)" >> /tmp/registry-service.env
	$(SSH) "mkdir -p $(REMOTE_DIR)"
	$(SCP) /tmp/registry-service.tar ../docker-compose.yml $(REMOTE):$(REMOTE_DIR)/
	$(SCP) /tmp/registry-service.env $(REMOTE):$(REMOTE_DIR)/.env
	rm -f /tmp/registry-service.tar /tmp/registry-service.env

# Load the shipped image and bring the compose stack up on the instance.
remote-up:
	$(SSH) "cd $(REMOTE_DIR) && docker load -i registry-service.tar && sudo docker compose up -d"

remote-down:
	$(SSH) "cd $(REMOTE_DIR) && sudo docker compose down"

# Tail docker compose logs on the instance.
logs:
	$(SSH) "cd $(REMOTE_DIR) && sudo docker compose logs -f"

# S3 bucket for uploaded OCI images. Independent of the csav EC2 stack.
deploy-storage:
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STORAGE_STACK_NAME) \
		--region $(REGION)

destroy-storage:
	aws cloudformation delete-stack --stack-name $(STORAGE_STACK_NAME) --region $(REGION)

# Send a local .tar as an OCI image upload: make upload FILE=path/to/image.tar
upload:
	curl -F "image=@$(FILE)" http://localhost:8080/upload
