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

# Demo: end-to-end build + execution. Resolved lazily so only the demo targets hit AWS.
REGION ?= ap-south-1
KEY_PATH := $(HOME)/.ssh/csav-key.pem
LOG_HOST ?= gdpr-log.prdai.dev
instance_ip = $(shell aws ec2 describe-instances --region $(REGION) --instance-ids $(shell aws cloudformation describe-stacks \
	--stack-name $(1) --region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='$(2)'].OutputValue" --output text) \
	--query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
CSAV_IP = $(call instance_ip,csav,CsavInstanceId)
SCE_IP = $(call instance_ip,execution-service,ExecutionServiceInstanceId)
PDM_TABLE = $(shell aws cloudformation describe-stacks --stack-name pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='PersonalDataTableName'].OutputValue" --output text)
DATA_KEY_TABLE = $(shell aws cloudformation describe-stacks --stack-name pdm-service-dev --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='DataKeyTableName'].OutputValue" --output text)
# registry-service stores each algorithm's per-algo KMS key ARN here; seeding reads it to encrypt the records.
ALGORITHM_TABLE = $(shell aws cloudformation describe-stacks --stack-name registry-service-storage --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text)

# Persistent demo fleet: each sample app is pinned to the fixed algorithmId its dataset is seeded under
# (see seeding/config.ts). Re-running any target rebinds the same ids, so the demo is stable and repeatable.
HEALTH_ID    := 662fa378-dc53-425d-9225-a187b11ea7dc
FINANCE_ID   := c7cc14fa-e962-4548-aff4-a54148798cd8
ECOMMERCE_ID := 3b8bba4a-8106-4309-9446-7bce99a1453a
SOCIAL_ID    := e4082659-08d6-4f0a-9e60-327e9410c710
EHEALTH_ID   := e587067e-47dc-4835-8f87-5e66fc979adf
DEMO_APPS := \
	health-risk-python:$(HEALTH_ID) \
	spend-analysis-go:$(FINANCE_ID) \
	product-trends-node:$(ECOMMERCE_ID) \
	audience-segments-rust:$(SOCIAL_ID) \
	trial-eligibility-ruby:$(EHEALTH_ID)

.PHONY: registry-logs demo-ready demo-seed demo-build demo-build-all demo-run demo-run-all demo-all \
	logs-csv logs-csv-algo logs-csv-all

# Tail registry-service's compose logs on the csav host (build phase).
registry-logs:
	$(MAKE) -C csav/registry-service logs

# Start the existing demo hosts when needed, then wait for their restarted Compose services.
demo-ready:
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
	csav_id=$$(get_instance_id csav CsavInstanceId); \
	sce_id=$$(get_instance_id execution-service ExecutionServiceInstanceId); \
	for spec in "CSAV:$$csav_id" "execution-service:$$sce_id"; do \
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
# (make demo-build), which provisions that key and stores its ARN in the AlgorithmTable.
demo-seed:
	cd seeding && bun install && bun run generate && PDM_TABLE=$(PDM_TABLE) DATA_KEY_TABLE=$(DATA_KEY_TABLE) ALGORITHM_TABLE=$(ALGORITHM_TABLE) AWS_REGION=$(REGION) bun run seed

# Build phase (one app): make demo-build APP=<dir> ALGORITHM_ID=<id>.
# Builds the arm64 image, ships it to the csav host, and registers it under ALGORITHM_ID.
# Prints {algorithmId, bucket, key}; watch `make registry-logs` alongside.
demo-build:
	@test -n "$(APP)" || { echo "APP is required (a sample/ dir)"; exit 1; }
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	docker build --platform linux/arm64 -t $(APP):demo sample/$(APP)
	docker save $(APP):demo -o /tmp/$(APP).tar
	scp -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new /tmp/$(APP).tar ec2-user@$(CSAV_IP):/tmp/$(APP).tar
	ssh -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new ec2-user@$(CSAV_IP) \
		'curl -sS -F "image=@/tmp/$(APP).tar" -F "algorithmId=$(ALGORITHM_ID)" http://localhost:8080/upload; echo'

# Build and register all five demo apps under their fixed ids.
demo-build-all:
	@for pair in $(DEMO_APPS); do \
		app=$${pair%%:*}; id=$${pair##*:}; \
		echo "=== build $$app ($$id) ==="; \
		$(MAKE) demo-build APP=$$app ALGORITHM_ID=$$id || exit 1; \
	done

# Execution phase (one run): make demo-run ALGORITHM_ID=<id>.
# Fires /run (202 + runId), then polls GET /run/{runId} until the enclave reports back.
demo-run:
	@test -n "$(ALGORITHM_ID)" || { echo "ALGORITHM_ID is required"; exit 1; }
	@ip=$(SCE_IP); \
	runId=$$(curl -sS -X POST http://$$ip:8080/run -H 'Content-Type: application/json' \
		-d '{"algorithmId":"$(ALGORITHM_ID)"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["runId"])'); \
	echo "runId=$$runId"; \
	for i in $$(seq 1 132); do \
		res=$$(curl -sS http://$$ip:8080/run/$$runId); \
		status=$$(echo "$$res" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))'); \
		if [ "$$status" != "pending" ]; then \
			echo "$$res"; \
			echo "$$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); out=r.get("output", "").strip(); parsed=json.loads(out) if out else {}; ok=r.get("status")=="exit:0" and bool(out) and not (isinstance(parsed, dict) and parsed.get("error")); sys.exit(0 if ok else 1)'; \
			exit $$?; \
		fi; \
		sleep 5; \
	done; \
	echo "timed out waiting for runId=$$runId"; exit 1

# Fire and poll every demo app in turn (sequential - each spins up its own enclave).
demo-run-all:
	@for pair in $(DEMO_APPS); do \
		app=$${pair%%:*}; id=$${pair##*:}; \
		echo "=== run $$app ($$id) ==="; \
		$(MAKE) demo-run ALGORITHM_ID=$$id || exit 1; \
	done

# Start the existing hosts, then build, seed, and run the whole fleet. Build comes first because it
# provisions the per-algorithm KMS keys used by seeding.
demo-all:
	$(MAKE) demo-ready
	$(MAKE) demo-build-all
	$(MAKE) demo-seed
	$(MAKE) demo-run-all

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
