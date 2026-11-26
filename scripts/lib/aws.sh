# shellcheck shell=bash
# shellcheck disable=SC2154

stack_output() {
	local stack="$1" key="$2" value
	value=$(aws cloudformation describe-stacks --stack-name "$stack" --region "$region" \
		--query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" --output text)
	[ -n "$value" ] && [ "$value" != None ] || die "no $key output on stack $stack"
	printf '%s' "$value"
}

host_matches() {
	local host="$1" pattern="$2" suffix
	[ "$host" = "$pattern" ] && return 0
	case "$pattern" in
	'*.'*)
		suffix=${pattern#\*.}
		case "$host" in
		*".$suffix")
			local prefix=${host%".$suffix"}
			[ -n "$prefix" ] && [[ "$prefix" != *.* ]] && return 0
			;;
		esac
		;;
	esac
	return 1
}

cert_for() {
	local host="$1" acm_region="${2:-$region}" arn candidate name
	arn=$(aws acm list-certificates --region "$acm_region" --certificate-statuses ISSUED \
		--query "CertificateSummaryList[?DomainName=='$host'].CertificateArn | [0]" --output text)
	if [ -z "$arn" ] || [ "$arn" = None ]; then
		for candidate in $(aws acm list-certificates --region "$acm_region" \
			--certificate-statuses ISSUED --query 'CertificateSummaryList[].CertificateArn' --output text); do
			for name in $(aws acm describe-certificate --region "$acm_region" --certificate-arn "$candidate" \
				--query 'Certificate.[DomainName,SubjectAlternativeNames]' --output text); do
				if host_matches "$host" "$name"; then
					arn=$candidate
					break 2
				fi
			done
		done
	fi
	[ -n "$arn" ] && [ "$arn" != None ] || die "no ISSUED ACM certificate for $host in $acm_region"
	printf '%s' "$arn"
}

default_vpc() {
	need AWS_REGION
	aws ec2 describe-vpcs --region "$region" --filters Name=is-default,Values=true \
		--query 'Vpcs[0].VpcId' --output text
}

sls() {
	local dir="$1"
	shift
	(
		cd "$dir" || exit
		bun install --frozen-lockfile
		bunx serverless deploy "$@"
	)
}
