#!/usr/bin/env bash
# Runs the real ESLint over tools/eslint-canaries and fails unless each rule
# reports its deliberate violation. A rule that stops looking reports nothing,
# which is indistinguishable from clean code — this is what tells them apart.
#
# Runs twice, from the repo root and from inside the canary directory, because
# a cwd-resolution bug only shows from a subdirectory.
#
# ESLint failing outright must NOT be reported as "the rule went quiet": that is
# the same conflation this script exists to catch, so the two are separated and
# eslint's own stderr is printed when it happens.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="tools/eslint-canaries"
EXPECTED=("lore/no-cross-layer-import" "import-x/no-cycle")

ERR_FILE="$(mktemp)"
trap 'rm -f "$ERR_FILE"' EXIT

check() {
  local label="$1" where="$2" path="$3" report status missing=0

  cd "$where" || exit 1
  report="$(npx eslint --no-ignore -f json "$path" 2>"$ERR_FILE")"
  status=$?

  # eslint exits 1 when it reports findings, which is the expected case here.
  # A higher code, or output that is not a JSON array, means it never ran.
  if [ "$status" -gt 1 ] || ! grep -q '^\[' <<<"$report"; then
    echo "::error::eslint did not run ($label, exit $status) — a broken check, not a quiet rule"
    echo "--- eslint stderr:"
    sed 's/^/    /' "$ERR_FILE" | head -25
    echo "--- eslint stdout:"
    sed 's/^/    /' <<<"$report" | head -5
    exit 1
  fi

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
check "repo root" "$ROOT" "$TARGET"

echo "[canary] from inside $TARGET"
check "subdirectory" "$ROOT/$TARGET" "."

echo "[canary] all expected findings present"
