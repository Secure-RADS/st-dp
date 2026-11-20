include ../../../mk/env.mk

IMAGE := registry-service:latest
STACK_NAME := secure-rads-csav
STORAGE_STACK_NAME := secure-rads-registry-service-storage
REGION := $(AWS_REGION)
$(call env_require,AWS_REGION)
KEY_PATH := $(abspath ../../../.ssh/csav-key.pem)
REMOTE_DIR := /home/ec2-user/registry-service

# Lazily resolved; public IP comes from a live describe-instances call since the CF stack's Outputs go stale on stop/start.
INSTANCE_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)
REMOTE_HOST = $(shell aws ec2 describe-instances --instance-ids $(INSTANCE_ID) --region $(REGION) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
REMOTE = ec2-user@$(REMOTE_HOST)
SSH = ssh -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new $(REMOTE)
SCP = scp -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new
ARTIFACT_BUCKET = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)
DYNAMO_TABLE = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)
# The per-algorithm KMS key policy references these role ARNs, so they're resolved from the stacks: IAM
# truncates role names at 64 chars, and a name match on 'CsavInstanceRole' also hits the legacy csav
# stack's role.
CSAV_ROLE_ARN = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceRoleArn'].OutputValue" --output text)
# kms-service performs the runtime Decrypt on the enclave's behalf; each algorithm's key policy names this role.
KMS_SERVICE_ROLE_ARN = $(shell aws cloudformation describe-stacks --stack-name secure-rads-kms-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='KmsServiceRoleArn'].OutputValue" --output text)
# mTLS domain (registerPCRs -> /algorithms) and its pin.
# Plain-TLS public domain (/challenge, /attest, /refresh) baked into the EIF's run config - a different
# domain and cert from the mTLS one above, so it gets its own pin.
VERIFIER_HOST = $(VERIFIER_ATTEST_HOST)
# pdm-service's plain-TLS domain (/records) also baked into the run config, pinned the same way.
# log-service's plain-TLS domain (/subject-access), baked in and pinned so the enclave can write its trail.
LOG_HOST = $(LOG_HOST_SECURE_RADS)
# telemetry-service's plain-TLS domain (/events), baked in and pinned for the diagnostic run timeline.
TELEMETRY_HOST = $(TELEMETRY_HOST_SECURE_RADS)
# cost-service's plain-TLS domain (/cost). Called by registry-service and the run host, never the enclave, so no pin.
COST_HOST = $(COST_HOST_SECURE_RADS)

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
	docker build --platform linux/arm64 -f ../../sce-unit/Dockerfile -t sce-unit-base:latest ../../..

# eif_build + kernel/init blobs - rebuild only when eif-build/ itself changes.
eif-build-base:
	docker build --platform linux/arm64 -t eif-build-base:latest ../../eif-build

# Self-signed client cert for mTLS to verifier-service - PoC only, baked
# into the image at build time (see csav/README.md's trust-material design).
gen-client-cert:
	@test -f tls/client.crt -a -f tls/client.key || ( \
		mkdir -p tls && \
		openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 3650 -nodes \
			-keyout tls/client.key -out tls/client.crt \
			-subj "/CN=registry-service")

# Build the docker image locally (arm64, matches the t4g.small host).
image: sce-unit-base eif-build-base gen-client-cert
	docker build --platform linux/arm64 -f Dockerfile -t $(IMAGE) ../../..

# Save the image + .env (bucket/region/pins for compose var substitution) and scp
# those to the instance. docker-compose.yml is baked at CSAV boot (UserData) — not shipped.
ship: image
	@$(call env_require,VERIFIER_URL)
	@$(call env_require,VERIFIER_PUBKEY_SHA256)
	@$(call env_require,VERIFIER_ATTEST_HOST)
	@$(call env_require,VERIFIER_HOST_PUBKEY_SHA256)
	@$(call env_require,PDM_HOST_PUBKEY_SHA256)
	@$(call env_require,LOG_HOST_PUBKEY_SHA256)
	@$(call env_require,KMS_HOST)
	@$(call env_require,KMS_HOST_PUBKEY_SHA256)
	@$(call env_require,TELEMETRY_HOST_PUBKEY_SHA256)
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
	echo "TELEMETRY_HOST=$(TELEMETRY_HOST)" >> /tmp/registry-service.env
	echo "TELEMETRY_HOST_PUBKEY_SHA256=$(TELEMETRY_HOST_PUBKEY_SHA256)" >> /tmp/registry-service.env
	echo "KMS_HOST=$(KMS_HOST)" >> /tmp/registry-service.env
	echo "KMS_HOST_PUBKEY_SHA256=$(KMS_HOST_PUBKEY_SHA256)" >> /tmp/registry-service.env
	echo "COST_HOST=$(COST_HOST)" >> /tmp/registry-service.env
	echo "KMS_SERVICE_ROLE_ARN=$(KMS_SERVICE_ROLE_ARN)" >> /tmp/registry-service.env
	echo "CSAV_ROLE_ARN=$(CSAV_ROLE_ARN)" >> /tmp/registry-service.env
	$(SSH) "mkdir -p $(REMOTE_DIR)"
	$(SCP) /tmp/registry-service.tar $(REMOTE):$(REMOTE_DIR)/
	$(SCP) /tmp/registry-service.env $(REMOTE):$(REMOTE_DIR)/.env
	rm -f /tmp/registry-service.tar /tmp/registry-service.env

# Load the shipped image and (re)start the systemd-managed compose stack.
remote-up:
	$(SSH) "cd $(REMOTE_DIR) && docker load -i registry-service.tar && sudo systemctl restart csav-registry.service"

remote-down:
	$(SSH) "sudo systemctl stop csav-registry.service"

# Tail docker compose logs on the instance.
logs:
	$(SSH) "cd $(REMOTE_DIR) && sudo docker compose logs -f"

# S3 bucket + algorithm table, independent of the csav EC2 stack.
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
