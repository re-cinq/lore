#!/usr/bin/env bash
set -euo pipefail

# Re-embed rows the store holds without a usable vector, one bounded batch at a
# time through POST /api/ingest/reembed, until none remain.
#
#   scripts/infra/reembed.sh                 # every chunk schema + memories + facts with embedding IS NULL
#   scripts/infra/reembed.sh stale_links     # chunks embedded before coverage links were stripped
#   scripts/infra/reembed.sh missing platform
#
# Needs LORE_API_URL and LORE_INGEST_TOKEN (write scope). Exits 1 when the
# embedder returns no vector — that is the 403 outage, not a row to skip.

WHERE="${1:-missing}"
SCHEMA="${2:-}"
BATCH="${LORE_REEMBED_BATCH:-200}"
: "${LORE_API_URL:?LORE_API_URL must be set}"
: "${LORE_INGEST_TOKEN:?LORE_INGEST_TOKEN must be set}"

# The token rides in a header file so it never appears on a command line.
AUTH_FILE="$(mktemp)"
trap 'rm -f "$AUTH_FILE"' EXIT
printf 'Authorization: Bearer %s\n' "$LORE_INGEST_TOKEN" > "$AUTH_FILE"

body() {
  jq -nc --arg where "$WHERE" --arg schema "$SCHEMA" --argjson limit "$BATCH" \
    '{where: $where, limit: $limit} + (if $schema == "" then {} else {schema: $schema} end)'
}

while :; do
  res="$(curl -sf -X POST -H @"$AUTH_FILE" -H 'Content-Type: application/json' \
    -d "$(body)" "${LORE_API_URL}/api/ingest/reembed")"
  echo "[lore] $res"
  if [ "$(jq -r .stopped <<<"$res")" = "true" ]; then
    echo "[lore] ERROR: the embedder returned no vector — check lore-api logs for '[embeddings]'" >&2
    exit 1
  fi
  if [ "$(jq -r .remaining <<<"$res")" -le 0 ]; then
    break
  fi
done
echo "[lore] re-embed complete"
