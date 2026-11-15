#!/usr/bin/env bash
set -euo pipefail

readonly TS_LINT_PACKAGES=(
  packages/common
  rads/cost-service
  rads/csav/registry-service
  rads/log-service
  rads/pdm-service
  rads/result-consumer
  rads/sce/execution-service
  rads/transparency-portal
  secure/cost-service
  secure/log-service
  secure/pdm-service
  secure/result-consumer
  secure/sce/execution-service
  secure/transparency-portal
  secure/verifier-service
  seeding
)

readonly TS_TYPECHECK_PACKAGES=(
  packages/common
  rads/cost-service
  rads/csav/registry-service
  rads/log-service
  rads/pdm-service
  rads/result-consumer
  rads/sce/execution-service
  secure/cost-service
  secure/log-service
  secure/pdm-service
  secure/result-consumer
  secure/sce/execution-service
  secure/verifier-service
  seeding
)

readonly GO_MODULES=(
  packages/go-common
  secure/sce-unit
)

readonly CI_OWN_FILES='^\.github/(workflows/ci\.yml|scripts/changed-areas\.sh)'

FILES=''
COMMON_CHANGED=false

diff_range() {
  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
    git fetch --no-tags --quiet origin \
      "+refs/heads/${GITHUB_BASE_REF}:refs/remotes/origin/${GITHUB_BASE_REF}"
    printf 'origin/%s...HEAD' "${GITHUB_BASE_REF}"
  elif [[ -n "${BEFORE:-}" && ! "${BEFORE}" =~ ^0+$ ]]; then
    printf '%s...%s' "${BEFORE}" "${GITHUB_SHA}"
  else
    printf 'HEAD^...HEAD'
  fi
}

touches() {
  local prefix
  for prefix in "$@"; do
    [[ $FILES == *$'\n'"${prefix}"* || $FILES == "${prefix}"* ]] && return 0
  done
  return 1
}

to_json() {
  if (($# == 0)); then
    printf '[]'
    return
  fi
  printf '%s\n' "$@" | jq -R . | jq -sc .
}

select_ts() {
  local -a selected=()
  local package
  for package in "$@"; do
    if [[ $COMMON_CHANGED == true ]] || touches "${package}/"; then
      selected+=("${package}")
    fi
  done
  to_json "${selected[@]}"
}

main() {
  local -a changed
  cd "$(git rev-parse --show-toplevel)"
  mapfile -t changed < <(git diff --name-only "$(diff_range)")
  FILES="$(printf '%s\n' "${changed[@]}")"

  if [[ $FILES =~ $CI_OWN_FILES ]]; then
    printf 'ts_lint=%s\n' "$(to_json "${TS_LINT_PACKAGES[@]}")"
    printf 'ts_typecheck=%s\n' "$(to_json "${TS_TYPECHECK_PACKAGES[@]}")"
    printf 'go=%s\n' "$(to_json "${GO_MODULES[@]}")"
    printf 'python=true\n'
    return
  fi

  touches packages/common/ && COMMON_CHANGED=true

  printf 'ts_lint=%s\n' "$(select_ts "${TS_LINT_PACKAGES[@]}")"
  printf 'ts_typecheck=%s\n' "$(select_ts "${TS_TYPECHECK_PACKAGES[@]}")"

  local -a go_modules=()
  local module
  for module in "${GO_MODULES[@]}"; do
    if touches "${module}/" || touches "packages/go-common/"; then
      go_modules+=("${module}")
    fi
  done
  printf 'go=%s\n' "$(to_json "${go_modules[@]}")"

  if touches benchmark/; then
    printf 'python=true\n'
  else
    printf 'python=false\n'
  fi
}

main
