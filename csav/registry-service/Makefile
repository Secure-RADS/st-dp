IMAGE := registry-service:latest
STACK_NAME := csav
STORAGE_STACK_NAME := registry-service-storage
REGION ?= ap-southeast-2
KEY_PATH := $(abspath ../../.ssh/csav-key.pem)
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
# KMS key that encrypts the artifact bucket. Created by the storage stack; encryption set on the bucket via encrypt-bucket.
ARTIFACT_BUCKET_KMS_KEY_ARN = $(shell aws cloudformation describe-stacks --stack-name $(STORAGE_STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketKmsKeyArn'].OutputValue" --output text)
# CSAV writes EIFs (kms:GenerateDataKey); the enclave host reads them (kms:Decrypt). The key policy
# references these role ARNs, so they're resolved live (names carry a CFN-generated suffix).
CSAV_ROLE_ARN = $(shell aws iam list-roles --query "Roles[?contains(RoleName, 'CsavInstanceRole')].Arn | [0]" --output text)
ENCLAVE_HOST_ROLE_ARN = $(shell aws iam list-roles --query "Roles[?contains(RoleName, 'execution-service-dev-EnclaveHostInstanceRole')].Arn | [0]" --output text)
ROLE_PARAMETERS = $(strip $(if $(filter None,$(CSAV_ROLE_ARN)),,CsavInstanceRoleArn=$(CSAV_ROLE_ARN)) $(if $(filter None,$(ENCLAVE_HOST_ROLE_ARN)),,EnclaveHostInstanceRoleArn=$(ENCLAVE_HOST_ROLE_ARN)))
# mTLS domain (registerPCRs -> /algorithms) and its pin.
VERIFIER_URL ?= https://verifier.secure-rads.org/algorithms
VERIFIER_PUBKEY_SHA256 ?= 8187b2c5e26ac5079046dc74398ba43a0366f93c67cec94e8f4c378f7d2d9370
# Plain-TLS public domain (/attest, /refresh, /validate) baked into the EIF's run config - a different
# domain and cert from the mTLS one above, so it gets its own pin.
VERIFIER_HOST ?= verifier-attest.secure-rads.org
VERIFIER_HOST_PUBKEY_SHA256 ?= f447d6a73bc9309977d316032a51ea53ce3d0c0867a603ab823c0adb69fd08f0
# pdm-service's plain-TLS domain (/records) also baked into the run config, pinned the same way.
PDM_HOST ?= pdm.secure-rads.org
PDM_HOST_PUBKEY_SHA256 ?= 130823e12ad0f4cc0a78a102806d5e41327cd5b6a5ae90538689a70c93873e56
# log-service's plain-TLS domain (/events), baked in and pinned so the enclave can log its run timeline.
LOG_HOST ?= log.secure-rads.org
LOG_HOST_PUBKEY_SHA256 ?= 4ad2a53407cce9fbf808cd44f56d5174439b3184192301dda48cbbda82a13ddd

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

# The enclave host role ARN is baked into each per-algorithm KMS key policy by registry-service.
CSAV_ROLE_ARN = $(shell aws iam list-roles --query "Roles[?contains(RoleName, 'CsavInstanceRole')].Arn | [0]" --output text)
ENCLAVE_HOST_ROLE_ARN = $(shell aws iam list-roles --query "Roles[?contains(RoleName, 'execution-service-dev-EnclaveHostInstanceRole')].Arn | [0]" --output text)

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
	echo "ENCLAVE_HOST_ROLE_ARN=$(ENCLAVE_HOST_ROLE_ARN)" >> /tmp/registry-service.env
	echo "CSAV_ROLE_ARN=$(CSAV_ROLE_ARN)" >> /tmp/registry-service.env
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

# S3 bucket + the KMS key for uploads, independent of the csav EC2 stack.
deploy-storage:
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STORAGE_STACK_NAME) \
		--region $(REGION) \
		--capabilities CAPABILITY_NAMED_IAM $(if $(ROLE_PARAMETERS),--parameter-overrides $(ROLE_PARAMETERS))

destroy-storage:
	aws cloudformation delete-stack --stack-name $(STORAGE_STACK_NAME) --region $(REGION)

# Send a local .tar as an OCI image upload: make upload FILE=path/to/image.tar ALGORITHM_ID=<uuid>
upload:
	curl -F "image=@$(FILE)" -F "algorithmId=$(ALGORITHM_ID)" http://localhost:8080/upload
