#!/usr/bin/env bash
# The PR format job's fix pass over the files the branch changed, not the whole
# repo: `npm run format` spent ~4 of the job's ~5 minutes on type-aware
# `eslint . --fix`, and every test job waits on the format job. The `lint` job
# still lints the whole repo, so nothing goes unchecked.
#
# The spec and ADR pass stays whole: `re-lint/no-stale-spec-links` moves anchors
# in specs the branch never touched when a test it touched moved (8 s). It runs
# LAST, after eslint --fix and prettier have reflowed the test files: it reads
# the tree as it stands, so a pass before the reflow computes anchors the reflow
# then moves by a line or two, and the next run keeps those as hand-written.
# --quiet drops only warnings; an error it cannot repoint must fail the job.
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

mapfile -t LINTABLE < <(printf '%s\n' "${CHANGED[@]}" | grep -E '\.(ts|tsx|mts|cts|js|mjs|cjs)$' || true)
if ((${#LINTABLE[@]})); then
  # require-spec-link is detect-only and reads the anchors the spec pass below
  # has not repointed yet: left on, it fails every branch that moved a test and
  # set -e ends the script before prettier and the spec pass run. The lint job
  # still runs it, on the tree this script leaves.
  npx eslint --fix --no-warn-ignored --rule "re-lint/require-spec-link: off" "${LINTABLE[@]}"
fi

# The same globs `npm run format` hands prettier.
mapfile -t PRETTIER < <(printf '%s\n' "${CHANGED[@]}" | grep -E '^((apps|libs)/.*\.(ts|tsx|mjs|cjs|js|json)|scripts/.*\.(ts|mts|cts|mjs|cjs|js))$' || true)
if ((${#PRETTIER[@]})); then
  npx prettier --write "${PRETTIER[@]}"
fi

npx eslint "specs/**/*.md" "adrs/**/*.md" ".specify/spec.md" --fix --quiet
