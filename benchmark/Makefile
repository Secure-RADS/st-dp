REGION ?= ap-southeast-2
export AWS_REGION ?= $(REGION)
export AWS_DEFAULT_REGION ?= $(REGION)

REPS ?= 10
SIZES ?=
TREES ?= rads secure-rads
# Set SKIP=1 to reuse generated datasets and already-seeded PDM rows.
SKIP ?=

RUN_FLAGS := --reps $(REPS) --trees $(TREES)
ifneq ($(strip $(SIZES)),)
RUN_FLAGS += --sizes $(SIZES)
endif
ifeq ($(SKIP),1)
RUN_FLAGS += --skip-generate --skip-seed
endif

.PHONY: help run report

help:
	@echo "benchmark targets:"
	@echo "  make run     # Exp2 size sweep (override REPS= SIZES= TREES= SKIP=1)"
	@echo "  make report  # results/raw/ -> sweep.csv + figures/"
	@echo ""
	@echo "examples:"
	@echo "  make run"
	@echo "  make run REPS=3"
	@echo "  make run SIZES='10000 100000' REPS=10"
	@echo "  make run SKIP=1 REPS=3"
	@echo "  make report"

run:
	uv run python -m benchmark.run $(RUN_FLAGS)

report:
	uv run python -m benchmark.export
	uv run python -m benchmark.sweep
	@echo "wrote results/sweep.csv and results/figures/"
