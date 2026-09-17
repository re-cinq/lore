#!/usr/bin/env bash
# Print scripts/task-types.yaml followed by every scripts/task-types.*.yaml as
# one multi-document YAML stream — the single value the floor/lore-api
# ConfigMaps carry, and the same shape readTaskTypesSource() builds from disk.
# Deploy and render checks pass its output to `--set-file taskTypesConfig`.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"

cat "$dir/task-types.yaml"
for fragment in "$dir"/task-types.*.yaml; do
	[ -e "$fragment" ] || continue
	printf '\n---\n'
	cat "$fragment"
done
