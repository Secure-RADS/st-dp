#!/usr/bin/env bash
set -euo pipefail

status=0
modules=""

for file in "$@"; do
    case "$file" in
        */vendor/*) continue ;;
    esac

    dir=$(dirname "$file")
    while [ "$dir" != "." ] && [ ! -f "$dir/go.mod" ]; do
        dir=$(dirname "$dir")
    done

    if [ ! -f "$dir/go.mod" ]; then
        continue
    fi

    case " $modules " in
        *" $dir "*) continue ;;
    esac
    modules="$modules $dir"

    echo "gofmt: $dir"
    mapfile -t go_files < <(cd "$dir" && find . -name '*.go' -not -path './vendor/*')
    (cd "$dir" && gofmt -l -w "${go_files[@]}") || status=1

    echo "go vet: $dir"
    (cd "$dir" && go vet ./...) || status=1
done

exit "$status"
