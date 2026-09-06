#!/usr/bin/env bash
# Runs the real ESLint over tools/eslint-canaries and fails unless each rule
# reports its deliberate violation. A rule that stops looking reports nothing,
# which is indistinguishable from clean code — this is what tells them apart.
#
# Runs twice, from the repo root and from inside the canary directory, because
# a cwd-resolution bug only shows from a subdirectory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="tools/eslint-canaries"
EXPECTED=("lore/no-cross-layer-import" "import-x/no-cycle")

run_from() {
  local where="$1" path="$2"
  cd "$where"
  npx eslint --no-ignore -f json "$path" 2>/dev/null || true
}

assert_reported() {
  local label="$1" report="$2" missing=0

  for rule in "${EXPECTED[@]}"; do
    if grep -q "\"$rule\"" <<<"$report"; then
      echo "  ok   $rule"
    else
      echo "  MISSING  $rule"
      missing=1
    fi
  done

  if [ "$missing" -ne 0 ]; then
    echo "::error::eslint canary went quiet ($label) — a rule stopped reporting its deliberate violation"
    exit 1
  fi
}

echo "[canary] from the repo root"
assert_reported "repo root" "$(run_from "$ROOT" "$TARGET")"

echo "[canary] from inside $TARGET"
assert_reported "subdirectory" "$(run_from "$ROOT/$TARGET" ".")"

echo "[canary] all expected findings present"
