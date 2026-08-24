.PHONY: csav-key csav-deploy csav-destroy csav-status csav-up csav-down csav-ssh

csav-key:
	$(MAKE) -C csav key

csav-deploy:
	$(MAKE) -C csav deploy

csav-destroy:
	$(MAKE) -C csav destroy

csav-status:
	$(MAKE) -C csav status

csav-up:
	$(MAKE) -C csav up

csav-down:
	$(MAKE) -C csav down

csav-ssh:
	$(MAKE) -C csav ssh

# --- sce (execution-service) ---
.PHONY: sce-deploy sce-destroy sce-status sce-up sce-down sce-ssh sce-logs

sce-deploy:
	$(MAKE) -C sce deploy

sce-destroy:
	$(MAKE) -C sce destroy

sce-status:
	$(MAKE) -C sce status

sce-up:
	$(MAKE) -C sce up

sce-down:
	$(MAKE) -C sce down

sce-ssh:
	$(MAKE) -C sce ssh

sce-logs:
	$(MAKE) -C sce logs

# --- demo: end-to-end build + execution ---
# Resolved lazily so only the demo targets hit AWS.
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
instance_ip = $(shell aws ec2 describe-instances --region $(REGION) --instance-ids $(shell aws cloudformation describe-stacks \
	--stack-name $(1) --region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='$(2)'].OutputValue" --output text) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
CSAV_IP = $(call instance_ip,csav,CsavInstanceId)
SCE_IP = $(call instance_ip,execution-service,ExecutionServiceInstanceId)
SAMPLE_TAR := /tmp/registry-oci.tar

.PHONY: registry-logs demo-sample demo-build demo-run

# Tail registry-service's compose logs on the csav host (build phase).
registry-logs:
	$(MAKE) -C csav/registry-service logs

# Build the sample Data Controller image (arm64) and save it as the upload .tar.
demo-sample:
	docker build --platform linux/arm64 -t registry-oci:latest sample/registry-oci
	docker save registry-oci:latest -o $(SAMPLE_TAR)

# Build phase: ship the sample .tar to the csav host and POST it to registry-service.
# Prints {algorithmId, bucket, key}; watch `make registry-logs` alongside.
demo-build:
	scp -i $(KEY_PATH) $(SAMPLE_TAR) ec2-user@$(CSAV_IP):/tmp/registry-oci.tar
	ssh -i $(KEY_PATH) ec2-user@$(CSAV_IP) 'curl -sS -F "image=@/tmp/registry-oci.tar" http://localhost:8080/upload; echo'

# Execution phase: make demo-run ALGORITHM_ID=<id from demo-build>.
# Blocks until the enclave host calls back, then prints {algorithmId, instanceId, status, output}.
demo-run:
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	curl -sS -m 660 -X POST http://$(SCE_IP):8080/run -H 'Content-Type: application/json' \
		-d '{"algorithmId":"$(ALGORITHM_ID)"}'; echo
