#!/usr/bin/env bash
# The PR format job's fix pass over the files the branch changed, not the whole
# repo: `npm run format` spent ~4 of the job's ~5 minutes on type-aware
# `eslint . --fix`, and every test job waits on the format job. The `lint` job
# still lints the whole repo, so nothing goes unchecked.
#
# The spec and ADR pass stays whole: `re-lint/no-stale-spec-links` moves anchors
# in specs the branch never touched when a test it touched moved (8 s).
# A change to the lint or format setup reaches every file, so it formats all.
#
# Usage: format-changed.sh <base ref>   e.g. format-changed.sh origin/main
set -euo pipefail

BASE="${1:?base ref, e.g. origin/main}"
export NODE_OPTIONS=--max-old-space-size=8192

mapfile -t CHANGED < <(git diff --name-only --diff-filter=d "${BASE}...HEAD")

if printf '%s\n' "${CHANGED[@]}" | grep -qE '^(eslint\.config\.mjs|eslint\.baseline\..*|\.prettierrc|\.prettierignore|package-lock\.json)$'; then
  echo "[lore] lint or format setup changed; formatting the whole repo"
  exec npm run format
fi

echo "[lore] formatting ${#CHANGED[@]} changed file(s) against ${BASE}"

# `;` in `npm run format`: a spec pass with errors left still lets the rest run.
npx eslint "specs/**/*.md" "adrs/**/*.md" ".specify/spec.md" --fix --quiet || true

mapfile -t LINTABLE < <(printf '%s\n' "${CHANGED[@]}" | grep -E '\.(ts|tsx|mts|cts|js|mjs|cjs)$' || true)
if ((${#LINTABLE[@]})); then
  npx eslint --fix --no-warn-ignored "${LINTABLE[@]}"
fi

# The same globs `npm run format` hands prettier.
mapfile -t PRETTIER < <(printf '%s\n' "${CHANGED[@]}" | grep -E '^((apps|libs)/.*\.(ts|tsx|mjs|cjs|js|json)|scripts/.*\.(ts|mts|cts|mjs|cjs|js))$' || true)
if ((${#PRETTIER[@]})); then
  npx prettier --write "${PRETTIER[@]}"
fi
