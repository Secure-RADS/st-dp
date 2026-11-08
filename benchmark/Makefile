include ../mk/env.mk

REGION ?= ap-southeast-2
export AWS_REGION ?= $(REGION)
export AWS_DEFAULT_REGION ?= $(REGION)
export PYTHONPATH := src

REPS ?= 10
TREES ?= rads secure-rads

TREE_FLAGS := --trees $(TREES)
RUN_FLAGS := --reps $(REPS) $(TREE_FLAGS) --skip-generate --skip-seed
SEED_FLAGS := $(TREE_FLAGS) --setup-only

.PHONY: help seed run export plot graph report all

help:
	@echo "benchmark targets:"
	@echo "  make seed      # generate dataset, upload algorithms, BatchWrite PDM"
	@echo "  make run       # size sweep only (override REPS= TREES=)"
	@echo "  make export    # results/raw/ -> phase-timings.csv"
	@echo "  make plot      # phase-timings.csv -> figures/ (alias: graph)"
	@echo "  make report    # export + plot"
	@echo "  make all       # seed + run + report"
	@echo ""
	@echo "examples:"
	@echo "  make seed"
	@echo "  make run REPS=1"
	@echo "  make run TREES=rads REPS=2"
	@echo "  make export && make plot"
	@echo "  make all REPS=3"

seed:
	uv run python -m execute $(SEED_FLAGS)

run:
	uv run python -m execute $(RUN_FLAGS)

export:
	uv run python -m export

plot:
	uv run python -m plot

graph: plot

report: export plot
	@echo "wrote results/phase-timings.csv and results/figures/"

all: seed run report
