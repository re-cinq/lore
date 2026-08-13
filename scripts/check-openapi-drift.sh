#!/usr/bin/env bash
# Fail if the committed OpenAPI artifact or the generated web-ui client types have
# drifted from the routes (ADR-035). `apps/lore-api/openapi.json` is generated from
# `routeList`, and `apps/web-ui/src/lib/api/schema.d.ts` is generated from it —
# web-ui's Docker context cannot reach lore-api at build time, so both are committed.
# Regenerate:
#
#   npm run build -w @re-cinq/lore-api \
#     && npm run gen:openapi -w @re-cinq/lore-api \
#     && npm run gen:api-types -w @re-cinq/lore-api
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

npm run build -w @re-cinq/lore-api >/dev/null
npm run gen:openapi -w @re-cinq/lore-api >/dev/null
npm run gen:api-types -w @re-cinq/lore-api >/dev/null

artifacts=("apps/lore-api/openapi.json" "apps/web-ui/src/lib/api/schema.d.ts")

# `git diff` says nothing about an UNTRACKED file, so a guard that only diffs would
# pass forever if an artifact were never committed — exactly the state this replaces.
for artifact in "${artifacts[@]}"; do
	if ! git ls-files --error-unmatch "$artifact" >/dev/null 2>&1; then
		echo >&2 "ERROR: $artifact is not committed — the generated artifacts must be in git." >&2
		exit 1
	fi
done

if git diff --quiet -- "${artifacts[@]}"; then
	echo "openapi.json and the generated client types are in sync with the routes."
else
	echo >&2
	echo "ERROR: the OpenAPI artifacts are out of sync with the routes." >&2
	echo "Regenerate: npm run build -w @re-cinq/lore-api && npm run gen:openapi -w @re-cinq/lore-api && npm run gen:api-types -w @re-cinq/lore-api" >&2
	git --no-pager diff --stat -- "${artifacts[@]}" >&2
	exit 1
fi
