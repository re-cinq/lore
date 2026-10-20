#!/usr/bin/env bash
# Mirror every spec and ADR of every onboarded repo into Utopia
# (specs/utopia-graph-mirror, "Backfill"): one POST
# /api/repos/{owner}/{repo}/utopia/backfill per repo listed by GET /api/repos.
#
#   LORE_API_URL=https://lore.example LORE_ADMIN_TOKEN=... ./scripts/infra/utopia-backfill.sh
#
# Safe to re-run: a document Utopia already holds comes back unchanged. A repo
# with no Utopia source on a deployment that cannot set one up (409) is skipped.
# Exit 1 when any repo fails or any document did not land whole.
set -euo pipefail

log() { echo "[lore] $*"; }
die() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl not found"
command -v jq >/dev/null || die "jq not found"
[ -n "${LORE_API_URL:-}" ] || die "LORE_API_URL is not set"
[ -n "${LORE_ADMIN_TOKEN:-}" ] || die "LORE_ADMIN_TOKEN (an admin-scope token) is not set"

api="${LORE_API_URL%/}/api"
auth="Authorization: Bearer $LORE_ADMIN_TOKEN"

onboarded_repos() {
  local offset=0 page total
  while :; do
    page="$(curl -fsS -H "$auth" "$api/repos?limit=100&offset=$offset")" ||
      die "GET /api/repos failed"
    jq -r '.repos[].full_name' <<<"$page"
    total="$(jq -r '.total' <<<"$page")"
    offset=$((offset + 100))
    [ "$offset" -lt "$total" ] || break
  done
}

backfill() {
  local repo="$1" out status
  out="$(mktemp)"
  status="$(curl -sS -m 1800 -o "$out" -w '%{http_code}' -X POST -H "$auth" \
    "$api/repos/$repo/utopia/backfill")" || status="000"
  case "$status" in
    200)
      log "$repo: $(jq -r '"\(.documents) documents at \(.commit[0:7]): \(.created) created, \(.updated) updated, \(.unchanged) unchanged, \(.failed | length) failed"' "$out")"
      jq -r '.failed[] | "[lore]   failed: \(.)"' "$out"
      [ "$(jq '.failed | length' "$out")" -eq 0 ] || problems=1
      ;;
    409) log "$repo: skipped, $(jq -r '.error' "$out")" ;;
    *)
      log "$repo: HTTP $status $(head -c 300 "$out")"
      problems=1
      ;;
  esac
  rm -f "$out"
}

problems=0
repos="$(onboarded_repos)"
log "Backfilling $(grep -c . <<<"$repos" || true) repos into Utopia"
while read -r repo; do
  [ -n "$repo" ] && backfill "$repo"
done <<<"$repos"

[ "$problems" -eq 0 ] || die "some repos did not mirror whole"
log "Done"
