IMAGE := registry-service:latest
STACK_NAME := csav
STORAGE_STACK_NAME := registry-service-storage
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
REMOTE_DIR := /home/ec2-user/registry-service

# Lazily resolved; public IP comes from a live describe-instances call since the CF stack's Outputs go stale on stop/start.
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)
REMOTE_HOST = $(shell aws ec2 describe-instances --instance-ids $(INSTANCE_ID) --region $(REGION) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
REMOTE = ec2-user@$(REMOTE_HOST)
SSH := ssh -i $(KEY_PATH) $(REMOTE)
SCP := scp -i $(KEY_PATH)
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
DYNAMO_TABLE = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
# mTLS domain (registerPCRs -> /algorithms) and its pin.
VERIFIER_URL ?= https://gdpr-verifier.prdai.dev/algorithms
VERIFIER_PUBKEY_SHA256 ?= 172602c618994c4bd5e408b3343f1c49ffa019595d7d19788f331a8f0e928316
# Plain-TLS public domain (/attest, /refresh, /validate) baked into the EIF's run config - a different
# domain and cert from the mTLS one above, so it gets its own pin.
VERIFIER_HOST ?= gdpr-verifier-attest.prdai.dev
VERIFIER_HOST_PUBKEY_SHA256 ?= bd29979723d431841740fa187b7beff639c47af00d7f1771ba212e9a6bd222a5
# pdm-service's plain-TLS domain (/records) also baked into the run config, pinned the same way.
PDM_HOST ?= gdpr-pdm.prdai.dev
PDM_HOST_PUBKEY_SHA256 ?= e095929a76034da7103afff4e5be9a7e194654848f855d3b4d121541fe89dfa5
# log-service's plain-TLS domain (/events), baked in and pinned so the enclave can log its run timeline.
LOG_HOST ?= gdpr-log.prdai.dev
LOG_HOST_PUBKEY_SHA256 ?=

.PHONY: build test run clean sce-unit-base eif-build-base gen-client-cert image ship remote-up remote-down logs deploy-storage destroy-storage upload

build:
	go build -o /tmp/registry-service .

test:
	go test ./...

run:
	AWS_REGION=$(REGION) ARTIFACT_BUCKET=$(ARTIFACT_BUCKET) go run .

clean:
	rm -f /tmp/registry-service

# Pre-built asset baked into the app image at build time - rebuild only when sce-unit itself changes, not per upload.
sce-unit-base:
	docker build --platform linux/arm64 -t sce-unit-base:latest ../../sce-unit

# eif_build + kernel/init blobs - rebuild only when eif-build/ itself changes.
eif-build-base:
	docker build --platform linux/arm64 -t eif-build-base:latest ../../eif-build

# Self-signed client cert for mTLS to verifier-service - PoC only, baked
# into the image at build time (see csav/README.md's trust-material design).
gen-client-cert:
	mkdir -p tls
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 3650 -nodes \
		-keyout tls/client.key -out tls/client.crt \
		-subj "/CN=registry-service"

# Build the docker image locally (arm64, matches the t4g.nano host).
image: sce-unit-base eif-build-base
	docker build --platform linux/arm64 -t $(IMAGE) .

# Save the image + docker-compose.yml + .env (bucket/region for compose var
# substitution), scp all three to the instance.
ship: image
	docker save $(IMAGE) -o /tmp/registry-service.tar
	echo "ARTIFACT_BUCKET=$(ARTIFACT_BUCKET)" > /tmp/registry-service.env
	echo "AWS_REGION=$(REGION)" >> /tmp/registry-service.env
	echo "DYNAMO_TABLE=$(DYNAMO_TABLE)" >> /tmp/registry-service.env
	echo "VERIFIER_URL=$(VERIFIER_URL)" >> /tmp/registry-service.env
	echo "VERIFIER_HOST=$(VERIFIER_HOST)" >> /tmp/registry-service.env
	echo "VERIFIER_PUBKEY_SHA256=$(VERIFIER_PUBKEY_SHA256)" >> /tmp/registry-service.env
	echo "VERIFIER_HOST_PUBKEY_SHA256=$(VERIFIER_HOST_PUBKEY_SHA256)" >> /tmp/registry-service.env
	echo "PDM_HOST=$(PDM_HOST)" >> /tmp/registry-service.env
	echo "PDM_HOST_PUBKEY_SHA256=$(PDM_HOST_PUBKEY_SHA256)" >> /tmp/registry-service.env
	echo "LOG_HOST=$(LOG_HOST)" >> /tmp/registry-service.env
	echo "LOG_HOST_PUBKEY_SHA256=$(LOG_HOST_PUBKEY_SHA256)" >> /tmp/registry-service.env
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

# Send a local .tar as an OCI image upload: make upload FILE=path/to/image.tar ALGORITHM_ID=<uuid>
upload:
	curl -F "image=@$(FILE)" -F "algorithmId=$(ALGORITHM_ID)" http://localhost:8080/upload
