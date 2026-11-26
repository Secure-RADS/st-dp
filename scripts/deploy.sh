#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2154
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

# shellcheck source=lib/common.sh
. "$repo_root/scripts/lib/common.sh"
# shellcheck source=lib/aws.sh
. "$repo_root/scripts/lib/aws.sh"
# shellcheck source=lib/env.sh
. "$repo_root/scripts/lib/env.sh"
# shellcheck source=lib/units.sh
. "$repo_root/scripts/lib/units.sh"

usage() {
	cat <<'EOF'
usage: scripts/deploy.sh deploy [tree] [unit...]

  deploy [tree] [unit...]   deploy a tree (all|secure|rads) or named units

tree defaults to all. Named units come from the unit lists in this script;
missing dependencies are not deployed automatically. Units run in
dependency-ordered waves, and every unit in a wave runs at the same time.
EOF
}

unit_done() {
	local needle="$1" unit
	[ ${#completed[@]} -eq 0 ] && return 1
	for unit in "${completed[@]}"; do
		[ "$unit" = "$needle" ] && return 0
	done
	return 1
}

unit_in_plan() {
	local needle="$1" unit
	for unit in "${plan[@]}"; do
		[ "$unit" = "$needle" ] && return 0
	done
	return 1
}

run_wave() {
	local -a wave=("$@") pids=() logs=()
	local i fail unit log
	for unit in "${wave[@]}"; do
		log=$(mktemp)
		(deploy_unit "$unit") >"$log" 2>&1 &
		pids+=("$!")
		logs+=("$log")
	done
	fail=0
	for i in "${!pids[@]}"; do
		wait "${pids[$i]}" || fail=1
	done
	for i in "${!wave[@]}"; do
		printf '==> %s\n' "${wave[$i]}"
		cat "${logs[$i]}"
		rm -f "${logs[$i]}"
	done
	[ "$fail" = 0 ] || die "one or more units failed"
}

deploy_parallel() {
	local -a remaining=("${plan[@]}") completed=() wave=() next=()
	local unit dep ok
	while [ ${#remaining[@]} -gt 0 ]; do
		wave=()
		for unit in "${remaining[@]}"; do
			ok=1
			for dep in ${DEPENDS[$unit]-}; do
				unit_in_plan "$dep" || continue
				unit_done "$dep" || {
					ok=0
					break
				}
			done
			[ "$ok" = 1 ] && wave+=("$unit")
		done
		[ ${#wave[@]} -gt 0 ] || die "dependency cycle among: ${remaining[*]}"
		run_wave "${wave[@]}"
		completed+=("${wave[@]}")
		next=()
		for unit in "${remaining[@]}"; do
			ok=1
			for dep in "${wave[@]}"; do
				[ "$unit" = "$dep" ] && ok=0
			done
			[ "$ok" = 1 ] && next+=("$unit")
		done
		remaining=("${next[@]}")
	done
}

planned_units() {
	local tree="$1"
	shift
	local -a tree_units unit want
	case "$tree" in
	all) tree_units=("${units_secure[@]}" "${units_rads[@]}") ;;
	secure) tree_units=("${units_secure[@]}") ;;
	rads) tree_units=("${units_rads[@]}") ;;
	*) die "unknown tree: $tree (all|secure|rads)" ;;
	esac

	if [ $# -eq 0 ]; then
		printf '%s\n' "${tree_units[@]}"
		return 0
	fi

	for unit in "${tree_units[@]}"; do
		for want in "$@"; do
			[ "$unit" = "$want" ] && printf '%s\n' "$unit"
		done
	done
}

cmd=${1:-}
[ -n "$cmd" ] || {
	usage
	exit 1
}
shift

positional=()
for arg in "$@"; do
	case "$arg" in
	-h | --help)
		usage
		exit 0
		;;
	-*) die "unknown option: $arg" ;;
	*) positional+=("$arg") ;;
	esac
done

[ "$cmd" = deploy ] || {
	usage
	exit 1
}

tree=${positional[0]:-all}
[ ${#positional[@]} -gt 0 ] && positional=("${positional[@]:1}")
[ "$tree" = secure-rads ] && tree=secure

case "$tree" in
all | secure | rads) ;;
*) die "unknown tree: $tree (all|secure|rads)" ;;
esac

case "$tree" in
all) allowed=("${units_secure[@]}" "${units_rads[@]}") ;;
secure) allowed=("${units_secure[@]}") ;;
rads) allowed=("${units_rads[@]}") ;;
esac
for requested in "${positional[@]}"; do
	known=0
	for unit in "${allowed[@]}"; do
		[ "$requested" = "$unit" ] && known=1 && break
	done
	[ "$known" = 1 ] || die "unknown unit for tree $tree: $requested"
done

load_env
prepare_deps

mapfile -t plan < <(planned_units "$tree" "${positional[@]}")
[ ${#plan[@]} -gt 0 ] || die "no units selected for tree $tree"

deploy_parallel
