#!/usr/bin/env bash
# Source this to load the single root .env into the current shell.
# shellcheck shell=bash

if ! repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null); then
    repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fi

env_file="$repo_root/.env"
if [ ! -f "$env_file" ]; then
    echo "env: $env_file not found. Copy .env.example to .env and fill it in." >&2
    if [ "${BASH_SOURCE[0]}" != "$0" ]; then
        return 1
    fi
    exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
