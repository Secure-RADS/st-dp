# shellcheck shell=bash
# shellcheck disable=SC2034

ensure_env_file() {
	[ -f .env ] && return 0
	local key default value
	: >.env
	while IFS='=' read -r key default; do
		value="${!key-}"
		[ -n "$value" ] || value="$default"
		printf '%s=%s\n' "$key" "$value" >>.env
	done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=\(.*\)$/\1=\2/p' .env.example)
	chmod 600 .env
}

load_env() {
	ensure_env_file
	scripts/derive-env.sh >/dev/null
	set -a
	# shellcheck disable=SC1091
	. ./.env
	set +a
	region=${AWS_REGION:-ap-southeast-2}
}

prepare_deps() {
	(
		cd packages/common || exit
		bun install --frozen-lockfile
	)
}
