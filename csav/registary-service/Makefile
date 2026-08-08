IMAGE := registry-service:latest
STACK_NAME := csav
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
REMOTE_DIR := /home/ec2-user/registry-service

# Lazily resolved (only hits AWS when a target that uses it actually runs).
REMOTE_HOST = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstancePublicIp'].OutputValue" --output text)
REMOTE = ec2-user@$(REMOTE_HOST)
SSH := ssh -i $(KEY_PATH) $(REMOTE)
SCP := scp -i $(KEY_PATH)

.PHONY: build test run clean image ship remote-up remote-down logs

build:
	go build -o /tmp/registry-service .

test:
	go test ./...

run:
	go run .

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
