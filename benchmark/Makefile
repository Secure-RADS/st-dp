REGION ?= ap-southeast-2
export AWS_REGION ?= $(REGION)
export AWS_DEFAULT_REGION ?= $(REGION)

REPS ?= 10
SIZES ?=
TREES ?= rads secure-rads
# Set SKIP=1 to reuse generated datasets and already-seeded PDM rows.
SKIP ?=
# Largest ehealth size; one BatchWrite covers every smaller size in the sweep.
SEED_DATASET ?= ehealth-100k

RUN_FLAGS := --reps $(REPS) --trees $(TREES)
ifneq ($(strip $(SIZES)),)
RUN_FLAGS += --sizes $(SIZES)
endif
ifeq ($(SKIP),1)
RUN_FLAGS += --skip-generate --skip-seed
endif

.PHONY: help install generate seed run smoke reuse export figures report

help:
	@echo "benchmark targets:"
	@echo "  make install   # uv sync + bun install (benchmark + seeding)"
	@echo "  make generate  # write seeding/datasets/ (shared faker stream)"
	@echo "  make seed      # BatchWrite $(SEED_DATASET) into rads + secure-rads"
	@echo "  make run       # full Exp2 matrix (override REPS= SIZES= TREES= SKIP=1)"
	@echo "  make smoke     # cheap check: 10K+100K, 3 reps"
	@echo "  make reuse     # run with --skip-generate --skip-seed"
	@echo "  make export    # raw sweep JSON + log-service -> results/sweep.csv"
	@echo "  make figures   # results/sweep.csv -> results/figures/"
	@echo "  make report    # export + figures"
	@echo ""
	@echo "examples:"
	@echo "  make smoke"
	@echo "  make run REPS=3"
	@echo "  make run SIZES='10000 100000' REPS=10"
	@echo "  make reuse REPS=3 SIZES='10000 25000 50000 75000 100000'"

install:
	uv sync
	bun install
	cd ../seeding && bun install

generate:
	cd ../seeding && bun install && bun run generate

# Resolve CFN table names inside the recipe so `make help` stays offline.
seed: generate
	@set -e; \
	rads_pdm=$$(aws cloudformation describe-stacks --stack-name rads-pdm-service-dev --region $(REGION) \
		--query "Stacks[0].Outputs[?OutputKey=='PersonalDataTableName'].OutputValue" --output text); \
	pdm=$$(aws cloudformation describe-stacks --stack-name secure-rads-pdm-service-dev --region $(REGION) \
		--query "Stacks[0].Outputs[?OutputKey=='PersonalDataTableName'].OutputValue" --output text); \
	dek=$$(aws cloudformation describe-stacks --stack-name secure-rads-pdm-service-dev --region $(REGION) \
		--query "Stacks[0].Outputs[?OutputKey=='DataKeyTableName'].OutputValue" --output text); \
	algo=$$(aws cloudformation describe-stacks --stack-name secure-rads-registry-service-storage --region $(REGION) \
		--query "Stacks[0].Outputs[?OutputKey=='AlgorithmTableName'].OutputValue" --output text); \
	cd ../seeding && RADS_PDM_TABLE="$$rads_pdm" SEED_DATASET="$(SEED_DATASET)" bun run seed-rads; \
	cd ../seeding && PDM_TABLE="$$pdm" DATA_KEY_TABLE="$$dek" ALGORITHM_TABLE="$$algo" \
		SEED_DATASET="$(SEED_DATASET)" bun run seed-secure-rads

run:
	uv run python run.py $(RUN_FLAGS)

smoke:
	$(MAKE) run REPS=3 SIZES='10000 100000' TREES='rads secure-rads' SKIP=$(SKIP)

reuse:
	$(MAKE) run SKIP=1 REPS=$(REPS) SIZES='$(SIZES)' TREES='$(TREES)'

export:
	bun install
	bun run export

figures:
	uv run python sweep.py

report: export figures
	@echo "wrote results/sweep.csv and results/figures/"
