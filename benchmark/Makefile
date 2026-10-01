REGION ?= ap-southeast-2
export AWS_REGION ?= $(REGION)
export AWS_DEFAULT_REGION ?= $(REGION)
export PYTHONPATH := src

REPS ?= 10
TREES ?= rads secure-rads
# Set SKIP=1 to reuse generated datasets and already-seeded PDM rows.
SKIP ?=

RUN_FLAGS := --reps $(REPS) --trees $(TREES)
ifeq ($(SKIP),1)
RUN_FLAGS += --skip-generate --skip-seed
endif

.PHONY: help execute report

help:
	@echo "benchmark targets:"
	@echo "  make execute     # Exp2 size sweep (override REPS= TREES= SKIP=1)"
	@echo "  make report  # results/raw/ -> sweep.csv + figures/"
	@echo ""
	@echo "examples:"
	@echo "  make execute"
	@echo "  make execute REPS=3"
	@echo "  make execute SKIP=1 REPS=3"
	@echo "  make report"

execute:
	uv run python -m execute $(RUN_FLAGS)

report:
	uv run python -m export
	uv run python -m plot
	@echo "wrote results/sweep.csv and results/figures/"
