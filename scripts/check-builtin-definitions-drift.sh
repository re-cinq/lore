#!/usr/bin/env bash
# Fail if web-ui's builtin assembly-line definitions have drifted from the YAMLs.
# apps/web-ui/src/lib/builtin-definitions.ts is generated from
# libs/assembly-lines/src/assembly-lines/*.yaml — web-ui is outside the npm
# workspace and carries no YAML parser, so it needs a copy, and a HAND copy rots
# (feature-planning sat at 2 nodes while the YAML had 9). Regenerate:
#
#   npm run build -w @re-cinq/lore-assembly-lines && npm run gen:builtin-definitions
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

npm run build -w @re-cinq/lore-assembly-lines >/dev/null
npm run gen:builtin-definitions >/dev/null

mirror="apps/web-ui/src/lib/builtin-definitions.ts"
if git diff --quiet -- "$mirror"; then
	echo "web-ui builtin definitions are in sync with the assembly-line YAMLs."
else
	echo >&2
	echo "ERROR: web-ui's builtin definitions are out of sync with the YAMLs." >&2
	echo "Regenerate: npm run build -w @re-cinq/lore-assembly-lines && npm run gen:builtin-definitions" >&2
	git --no-pager diff -- "$mirror" >&2
	exit 1
fi
