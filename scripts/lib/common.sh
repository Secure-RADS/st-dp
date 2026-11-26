# shellcheck shell=bash

die() {
	printf 'deploy: %s\n' "$*" >&2
	exit 1
}

need() {
	local key
	for key in "$@"; do
		[ -n "${!key-}" ] || die "$key is required"
	done
}

run() {
	printf '+ %s\n' "$*"
	"$@"
}
