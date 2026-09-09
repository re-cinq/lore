#!/usr/bin/env bash
set -euo pipefail

# Drop a repo's chunks for paths its tree no longer has (a rename's old path, a
# deleted file) or that today's classifier refuses (generated files indexed
# before the exclusion existed). Run from a checkout of the repo at the commit
# whose tree should win; the tree is posted, so the store never guesses.
#
#   scripts/infra/prune-orphan-chunks.sh [owner/repo]
#
# Needs LORE_API_URL and LORE_INGEST_TOKEN (write scope). The repo defaults to
# the checkout's origin remote.

REPO="${1:-$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/]+?)(\.git)?$#\1#')}"
: "${LORE_API_URL:?LORE_API_URL must be set}"
: "${LORE_INGEST_TOKEN:?LORE_INGEST_TOKEN must be set}"

AUTH_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
trap 'rm -f "$AUTH_FILE" "$BODY_FILE"' EXIT
printf 'Authorization: Bearer %s\n' "$LORE_INGEST_TOKEN" > "$AUTH_FILE"

# The whole tree, not the subtree under the shell's cwd: a path the body omits is a path the sweep deletes.
cd "$(git rev-parse --show-toplevel)"
git ls-files -z | jq -R -s -c 'split("\u0000") | map(select(. != "")) | {present_paths: .}' > "$BODY_FILE"
echo "[lore] pruning $REPO against $(jq '.present_paths | length' "$BODY_FILE") tracked paths"

curl -sf -X POST -H @"$AUTH_FILE" -H 'Content-Type: application/json' \
  --data-binary @"$BODY_FILE" "${LORE_API_URL}/api/repos/${REPO}/chunks/prune" \
  | jq '{schema, deleted_chunks, deleted_paths: (.deleted_paths | length), sample: .deleted_paths[0:10]}'
