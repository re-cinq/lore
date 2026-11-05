#!/usr/bin/env bash
# The spec and ADR pass of `npm run format` and the CI format job. It runs
# LAST, after eslint --fix and prettier have reflowed the test files the links
# cite. Two passes, because ESLint skips every warning-level rule under --quiet,
# fixes included, and `re-lint/no-stale-spec-links` is a warning: the first pass
# applies its fixes (the content hash and line of every link the branch wrote)
# and prints nothing, the second reports only errors, such as a link nothing can
# repoint, and its exit code fails the job.
set -euo pipefail

export NODE_OPTIONS=--max-old-space-size=8192
DOCS=("specs/**/*.md" "adrs/**/*.md" ".specify/spec.md")

npx eslint "${DOCS[@]}" --fix --format json --output-file /dev/null || true
npx eslint "${DOCS[@]}" --quiet
