IMAGE := registry-service:latest
STACK_NAME := csav
STORAGE_STACK_NAME := registry-service-storage
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
REMOTE_DIR := /home/ec2-user/registry-service

# Lazily resolved (only hits AWS when a target that uses it actually runs).
REMOTE_HOST = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstancePublicIp'].OutputValue" --output text)
REMOTE = ec2-user@$(REMOTE_HOST)
SSH := ssh -i $(KEY_PATH) $(REMOTE)
SCP := scp -i $(KEY_PATH)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)

.PHONY: build test run clean image ship remote-up remote-down logs deploy-storage destroy-storage upload

build:
	go build -o /tmp/registry-service .

test:
	go test ./...

run:
	AWS_REGION=$(REGION) ARTIFACT_BUCKET=$(ARTIFACT_BUCKET) go run .

clean:
	rm -f /tmp/registry-service

# Build the docker image locally (arm64, matches the t4g.nano host).
image:
	docker build --platform linux/arm64 -t $(IMAGE) .

# Save the image + docker-compose.yml, scp both to the instance.
ship: image
	docker save $(IMAGE) -o /tmp/registry-service.tar
	$(SSH) "mkdir -p $(REMOTE_DIR)"
	$(SCP) /tmp/registry-service.tar ../docker-compose.yml $(REMOTE):$(REMOTE_DIR)/
	rm -f /tmp/registry-service.tar

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
