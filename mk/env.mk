# Loads the single root .env for every Makefile that includes this fragment.
# Variables defined in .env are exported to recipes; nothing else is.

ENV_MK := $(abspath $(lastword $(MAKEFILE_LIST)))
REPO_ROOT := $(patsubst %/,%,$(dir $(patsubst %/,%,$(dir $(ENV_MK)))))
ENV_FILE := $(REPO_ROOT)/.env

ifeq ($(wildcard $(ENV_FILE)),)
$(error .env not found at $(ENV_FILE). Copy .env.example to .env and fill it in)
endif

include $(ENV_FILE)

ENV_KEYS := $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' $(ENV_FILE))
$(foreach key,$(ENV_KEYS),$(eval export $(key)))
