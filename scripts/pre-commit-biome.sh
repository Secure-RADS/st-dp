#!/usr/bin/env bash
set -euo pipefail

status=0

for file in "$@"; do
    case "$file" in
        */node_modules/* | */dist/* | */build/*) continue ;;
    esac

    dir=$(dirname "$file")
    while [ "$dir" != "." ] && [ ! -f "$dir/biome.json" ]; do
        dir=$(dirname "$dir")
    done

    if [ ! -f "$dir/biome.json" ]; then
        continue
    fi

    bin="$(cd "$dir" && pwd)/node_modules/.bin/biome"
    if [ ! -x "$bin" ]; then
        echo "biome: not installed in $dir (run bun install there)" >&2
        status=1
        continue
    fi

    runner=()
    if ! command -v node >/dev/null 2>&1; then
        runner=(bun)
    fi

    (cd "$dir" && "${runner[@]}" "$bin" check --write --no-errors-on-unmatched "${file#"$dir"/}") || status=1
done

exit "$status"
