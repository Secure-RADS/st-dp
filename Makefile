.PHONY: up down status secure-rads rads logs csav-key csav-deploy csav-destroy csav-status csav-up csav-down csav-ssh

up:
	$(MAKE) secure-rads-ready

down:
	$(MAKE) csav-down

status:
	$(MAKE) csav-status
	$(MAKE) sce-status
	$(MAKE) rads-status

secure-rads:
	$(MAKE) secure-rads-all

rads:
	$(MAKE) rads-all

logs:
	@set -u; \
	pids=""; \
	for target in registry-logs; do make $$target & pids="$$pids $$!"; done; \
	for group in $$(aws logs describe-log-groups --region "$(REGION)" --log-group-name-prefix /aws/lambda/ --query 'logGroups[].logGroupName' --output text); do \
		case "$$group" in /aws/lambda/secure-rads-execution-service-dev-*|/aws/lambda/secure-rads-verifier-service-dev-*|/aws/lambda/secure-rads-pdm-service-dev-*|/aws/lambda/secure-rads-log-service-dev-*|/aws/lambda/secure-rads-result-consumer-dev-*|/aws/lambda/rads-registry-service-dev-*|/aws/lambda/rads-pdm-service-dev-*|/aws/lambda/rads-log-service-dev-*|/aws/lambda/rads-result-consumer-dev-*|/aws/lambda/rads-execution-service-dev-*) aws logs tail "$$group" --region "$(REGION)" --follow & pids="$$pids $$!";; esac; \
	done; \
	trap 'kill $$pids 2>/dev/null || true' EXIT INT TERM; \
	for pid in $$pids; do wait "$$pid" || true; done

csav-key:
	$(MAKE) -C secure-rads/csav key

csav-deploy:
	$(MAKE) -C secure-rads/csav deploy

csav-destroy:
	$(MAKE) -C secure-rads/csav destroy

csav-status:
	$(MAKE) -C secure-rads/csav status

csav-up:
	$(MAKE) -C secure-rads/csav up

csav-down:
	$(MAKE) -C secure-rads/csav down

csav-ssh:
	$(MAKE) -C secure-rads/csav ssh

.PHONY: sce-deploy sce-destroy sce-status sce-logs

sce-deploy:
	$(MAKE) -C secure-rads/sce deploy

sce-destroy:
	$(MAKE) -C secure-rads/sce destroy

sce-status:
	$(MAKE) -C secure-rads/sce status

sce-logs:
	$(MAKE) -C secure-rads/sce logs

# End-to-end build + execution. Resolved lazily so only these targets hit AWS.
REGION ?= ap-southeast-2
KEY_PATH := $(CURDIR)/.ssh/csav-key.pem
LOG_HOST ?= log.secure-rads.org
instance_ip = $(shell aws ec2 describe-instances --region $(REGION) --instance-ids $(shell aws cloudformation describe-stacks \
	--stack-name $(1) --region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='$(2)'].OutputValue" --output text) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
CSAV_IP = $(call instance_ip,secure-rads-csav,CsavInstanceId)
EXECUTION_API_URL = $(shell aws cloudformation describe-stacks --stack-name secure-rads-execution-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='ExecutionApiUrl'].OutputValue" --output text)
PDM_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='PersonalDataTableName'].OutputValue" --output text)
DATA_KEY_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='DataKeyTableName'].OutputValue" --output text)
# registry-service stores each algorithm's per-algo KMS key ARN here; seeding reads it to encrypt the records.
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)

# Persistent fleet: each sample app is pinned to the fixed algorithmId its dataset is seeded under
# (see seeding/config.ts). Re-running any target rebinds the same ids, so the runs are stable and repeatable.
HEALTH_ID    := 662fa378-dc53-425d-9225-a187b11ea7dc
FINANCE_ID   := c7cc14fa-e962-4548-aff4-a54148798cd8
ECOMMERCE_ID := 3b8bba4a-8106-4309-9446-7bce99a1453a
SOCIAL_ID    := e4082659-08d6-4f0a-9e60-327e9410c710
EHEALTH_ID   := e587067e-47dc-4835-8f87-5e66fc979adf
SAMPLE_APPS := \
	health-risk-python:$(HEALTH_ID) \
	spend-analysis-go:$(FINANCE_ID) \
	product-trends-node:$(ECOMMERCE_ID) \
	audience-segments-rust:$(SOCIAL_ID) \
	trial-eligibility-ruby:$(EHEALTH_ID)

.PHONY: registry-logs secure-rads-ready secure-rads-seed secure-rads-build secure-rads-build-all secure-rads-run secure-rads-run-all secure-rads-all \
	rads-build rads-build-all rads-seed rads-run rads-run-all rads-all rads-status \
	logs-csv logs-csv-algo logs-csv-all portal-install portal-dev portal-infra portal-deploy portal-status \
	rads-portal-install rads-portal-dev rads-portal-infra rads-portal-deploy rads-portal-status

# Transparency portal (Vite SPA): data-subject lookup + service-authority dashboard.
# Hosted on S3 + CloudFront at transparency.sr.secure-rads.org.
portal-install:
	$(MAKE) -C secure-rads/transparency-portal install

portal-dev:
	$(MAKE) -C secure-rads/transparency-portal dev

portal-infra:
	$(MAKE) -C secure-rads/transparency-portal deploy-infra

portal-deploy:
	$(MAKE) -C secure-rads/transparency-portal deploy

portal-status:
	$(MAKE) -C secure-rads/transparency-portal status

# rads transparency portal: the same SPA pointed at the baseline endpoints (log.r / pdm.r).
# Hosted on S3 + CloudFront at transparency.r.secure-rads.org.
rads-portal-install:
	$(MAKE) -C rads/transparency-portal install

rads-portal-dev:
	$(MAKE) -C rads/transparency-portal dev

rads-portal-infra:
	$(MAKE) -C rads/transparency-portal deploy-infra

rads-portal-deploy:
	$(MAKE) -C rads/transparency-portal deploy

rads-portal-status:
	$(MAKE) -C rads/transparency-portal status

# Tail registry-service's compose logs on the csav host (build phase).
registry-logs:
	$(MAKE) -C secure-rads/csav/registry-service logs

# Start the CSAV host when needed, then wait for its restarted Compose service. execution-service is Lambda.
secure-rads-ready:
	@set -eu; \
	get_instance_id() { \
		aws cloudformation describe-stacks \
			--stack-name "$$1" \
			--region "$(REGION)" \
			--query "Stacks[0].Outputs[?OutputKey=='$$2'].OutputValue" \
			--output text; \
	}; \
	wait_for_ip() { \
		local instance_id="$$1" ip=""; \
		while [ -z "$$ip" ] || [ "$$ip" = None ]; do \
			ip=$$(aws ec2 describe-instances --region "$(REGION)" --instance-ids "$$instance_id" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text); \
			[ -n "$$ip" ] && [ "$$ip" != None ] || sleep 2; \
		done; \
		echo "$$ip"; \
	}; \
	wait_for_service() { \
		local name="$$1" ip="$$2"; \
		until ssh -i "$(KEY_PATH)" -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "ec2-user@$$ip" true 2>/dev/null; do sleep 5; done; \
		until curl -sS --connect-timeout 5 -o /dev/null "http://$$ip:8080/" 2>/dev/null; do sleep 5; done; \
		echo "$$name ready at $$ip"; \
	}; \
	csav_id=$$(get_instance_id secure-rads-csav CsavInstanceId); \
	for spec in "CSAV:$$csav_id"; do \
		name=$${spec%%:*}; id=$${spec##*:}; \
		state=$$(aws ec2 describe-instances --region $(REGION) --instance-ids $$id --query 'Reservations[0].Instances[0].State.Name' --output text); \
		if [ "$$state" = stopping ]; then aws ec2 wait instance-stopped --region $(REGION) --instance-ids $$id; state=stopped; fi; \
		if [ "$$state" = stopped ]; then echo "Starting $$name ($$id)"; aws ec2 start-instances --region $(REGION) --instance-ids $$id >/dev/null; \
		elif [ "$$state" != running ] && [ "$$state" != pending ]; then echo "$$name ($$id) is $$state" >&2; exit 1; fi; \
		aws ec2 wait instance-running --region $(REGION) --instance-ids $$id; \
		ip=$$(wait_for_ip "$$id"); \
		wait_for_service "$$name" "$$ip"; \
	done

# Seed all five context datasets into the PDM table, each under its fixed algorithmId. Records are
# envelope-encrypted under each algorithm's per-algo KMS key, so the algorithm must be built first
# (make secure-rads-build), which provisions that key and stores its ARN in the AlgorithmTable.
secure-rads-seed:
	cd seeding && bun install && bun run generate && PDM_TABLE=$(PDM_TABLE) DATA_KEY_TABLE=$(DATA_KEY_TABLE) ALGORITHM_TABLE=$(ALGORITHM_TABLE) AWS_REGION=$(REGION) bun run seed-secure-rads

# Build phase (one app): make secure-rads-build APP=<dir> ALGORITHM_ID=<id>.
# Builds the arm64 image, ships it to the csav host, and registers it under ALGORITHM_ID.
# Prints {algorithmId, bucket, key}; watch `make registry-logs` alongside.
secure-rads-build:
	@test -n "$(APP)" || { echo "APP is required (a secure-rads/samples dir)"; exit 1; }
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	docker build --platform linux/arm64 -t $(APP):local secure-rads/samples/$(APP)
	docker save $(APP):local -o /tmp/$(APP).tar
	scp -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new /tmp/$(APP).tar ec2-user@$(CSAV_IP):/tmp/$(APP).tar
	ssh -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new ec2-user@$(CSAV_IP) \
		'curl -sS -F "image=@/tmp/$(APP).tar" -F "algorithmId=$(ALGORITHM_ID)" http://localhost:8080/upload; echo'

# Build and register all five sample apps under their fixed ids.
secure-rads-build-all:
	@for pair in $(SAMPLE_APPS); do \
		app=$${pair%%:*}; id=$${pair##*:}; \
		$(MAKE) secure-rads-build APP=$$app ALGORITHM_ID=$$id || exit 1; \
	done

# Execution phase (one run): make secure-rads-run ALGORITHM_ID=<id>.
# Fires /run (202 + runId), then polls GET /run/{runId} until the enclave reports back.
secure-rads-run:
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	@api=$(EXECUTION_API_URL); \
	runId=$$(curl -sS -X POST "$$api/run" -H 'Content-Type: application/json' \
		-d '{"algorithmId":"$(ALGORITHM_ID)"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["runId"])'); \
	echo "runId=$$runId"; \
	for i in $$(seq 1 132); do \
		res=$$(curl -sS "$$api/run/$$runId"); \
		status=$$(echo "$$res" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))'); \
		if [ "$$status" != "pending" ]; then \
			echo "$$res"; \
			echo "$$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); out=r.get("output", "").strip(); parsed=json.loads(out) if out else {}; ok=r.get("status")=="exit:0" and bool(out) and not (isinstance(parsed, dict) and parsed.get("error")); sys.exit(0 if ok else 1)'; \
			exit $$?; \
		fi; \
		sleep 5; \
	done; \
	echo "timed out waiting for runId=$$runId"; exit 1

# Fire and poll every sample app in turn (sequential - each spins up its own enclave).
secure-rads-run-all:
	@for pair in $(SAMPLE_APPS); do \
		app=$${pair%%:*}; id=$${pair##*:}; \
		$(MAKE) secure-rads-run ALGORITHM_ID=$$id || exit 1; \
	done

# Start the existing hosts, then build, seed, and run the whole fleet. Build comes first because it
# provisions the per-algorithm KMS keys used by seeding.
secure-rads-all:
	$(MAKE) secure-rads-ready
	$(MAKE) secure-rads-build-all
	$(MAKE) secure-rads-seed
	$(MAKE) secure-rads-run-all

# --- rads: fully-trusted baseline. No enclave, no KMS, no verifier. Both registry and execution
# are serverless Lambdas (no CSAV host to start), upload is presigned-S3, and the PDM holds plaintext.

# rads registry and execution are HTTP APIs; the PDM table holds plaintext records.
RADS_REGISTRY_URL = $(shell aws cloudformation describe-stacks --stack-name rads-registry-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text)
RADS_EXECUTION_API_URL = $(shell aws cloudformation describe-stacks --stack-name rads-execution-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text)
RADS_PDM_TABLE = $(shell aws cloudformation describe-stacks --stack-name rads-pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='PersonalDataTableName'].OutputValue" --output text)

# Build phase (one app): make rads-build APP=<dir> ALGORITHM_ID=<id>.
# Builds the arm64 image, gets a presigned S3 PUT URL from /upload, uploads the tarball straight to S3, then
# /register verifies the object and records AlgorithmId -> (bucket, key). Prints that mapping.
rads-build:
	@test -n "$(APP)" || { echo "APP is required (a rads/samples dir)"; exit 1; }
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	docker build --platform linux/arm64 -t $(APP):local rads/samples/$(APP)
	docker save $(APP):local -o /tmp/$(APP).tar
	@reg=$(RADS_REGISTRY_URL); \
	url=$$(curl -sS -X POST "$$reg/upload" -H 'Content-Type: application/json' \
		-d '{"algorithmId":"$(ALGORITHM_ID)"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["uploadUrl"])'); \
	echo "PUTing $(APP).tar to S3"; \
	curl -sS -X PUT -H 'Content-Type: application/x-tar' --upload-file /tmp/$(APP).tar "$$url" >/dev/null; \
	curl -sS -X POST "$$reg/register" -H 'Content-Type: application/json' \
		-d '{"algorithmId":"$(ALGORITHM_ID)"}'; echo

# Build and register all five sample apps under their fixed ids.
rads-build-all:
	@for pair in $(SAMPLE_APPS); do \
		app=$${pair%%:*}; id=$${pair##*:}; \
		$(MAKE) rads-build APP=$$app ALGORITHM_ID=$$id || exit 1; \
	done

# Seed all five context datasets into the rads PDM table as plaintext, each under its fixed algorithmId.
rads-seed:
	cd seeding && bun install && bun run generate && RADS_PDM_TABLE=$(RADS_PDM_TABLE) AWS_REGION=$(REGION) bun run seed-rads

# Execution phase (one run): make rads-run ALGORITHM_ID=<id>.
# Fires /run (202 + runId), then polls GET /run/{runId} until the runner reports back.
rads-run:
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	@api=$(RADS_EXECUTION_API_URL); \
	runId=$$(curl -sS -X POST "$$api/run" -H 'Content-Type: application/json' \
		-d '{"algorithmId":"$(ALGORITHM_ID)"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["runId"])'); \
	echo "runId=$$runId"; \
	for i in $$(seq 1 132); do \
		res=$$(curl -sS "$$api/run/$$runId"); \
		status=$$(echo "$$res" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))'); \
		if [ "$$status" != "pending" ]; then \
			echo "$$res"; \
			echo "$$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); out=r.get("output", "").strip(); parsed=json.loads(out) if out else {}; ok=r.get("status")=="exit:0" and bool(out) and not (isinstance(parsed, dict) and parsed.get("error")); sys.exit(0 if ok else 1)'; \
			exit $$?; \
		fi; \
		sleep 5; \
	done; \
	echo "timed out waiting for runId=$$runId"; exit 1

# Fire and poll every sample app in turn (sequential - each spins up its own runner).
rads-run-all:
	@for pair in $(SAMPLE_APPS); do \
		app=$${pair%%:*}; id=$${pair##*:}; \
		$(MAKE) rads-run ALGORITHM_ID=$$id || exit 1; \
	done

# The whole rads fleet: build, seed, run. No host to start - registry and execution are Lambdas.
rads-all:
	$(MAKE) rads-build-all
	$(MAKE) rads-seed
	$(MAKE) rads-run-all

# Show the rads serverless stack outputs (API URLs and resource names).
rads-status:
	@for stack in rads-registry-service-dev rads-pdm-service-dev rads-log-service-dev rads-result-consumer-dev rads-execution-service-dev; do \
		aws cloudformation describe-stacks --stack-name $$stack --region $(REGION) --query 'Stacks[0].Outputs' --output table; \
	done

# Export one run's timeline to run-<RUN_ID>.csv. Needs both ids (the log table is keyed by algorithm).
logs-csv:
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required"; exit 1; }
	curl -sS "https://$(LOG_HOST)/logs/$(ALGORITHM_ID)?runId=$(RUN_ID)&format=csv" -o run-$(RUN_ID).csv
	@echo "wrote run-$(RUN_ID).csv"

# Export one algorithm's whole timeline to algo-<ALGORITHM_ID>.csv.
logs-csv-algo:
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	curl -sS "https://$(LOG_HOST)/logs/$(ALGORITHM_ID)?format=csv" -o algo-$(ALGORITHM_ID).csv
	@echo "wrote algo-$(ALGORITHM_ID).csv"

# Export the entire log table across all algorithms to logs-all.csv.
logs-csv-all:
	curl -sS "https://$(LOG_HOST)/logs?format=csv" -o logs-all.csv
	@echo "wrote logs-all.csv"
