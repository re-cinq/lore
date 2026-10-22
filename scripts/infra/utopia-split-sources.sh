#!/usr/bin/env bash
# Move an onboarded repo's Utopia knowledge base from the one `lore` source to a
# source per kind (specs/utopia-graph-mirror FR19, ADR-052 amendment 2026-10-22).
#
#   LORE_API_URL=https://lore.example LORE_ADMIN_TOKEN=... \
#   UTOPIA_API_URL=https://utopia.example UTOPIA_SESSION_TOKEN=... \
#     ./scripts/infra/utopia-split-sources.sh [--apply] [owner/repo ...]
#
# Without --apply it only counts what it would purge. With --apply, per repo:
#   1. deletes and purges every document of the repo's old `lore` source, live or
#      already deleted: Utopia holds one document with a given content per base, so
#      the same items cannot enter the new sources while the old ones stand;
#   2. resets the repo (POST /utopia/reset): the commit and tracker walks start over
#      and the stored test and code ingest commits are forgotten;
#   3. runs the backfill, which fills `docs`, `git-history` and `github`, then walks
#      the issues and pull requests until one walk comes back short.
# Tests and code reach `test-coverage` on the repo's next CI run (re-run its
# lore-tests workflow to do it now).
#
# UTOPIA_SESSION_TOKEN is a knowledge-base admin's session token: Utopia's delete
# and purge routes refuse a personal access token. Purging cannot be undone.
# Repos are done one at a time, and a repo whose purge failed is not backfilled.
# Exit 1 when any repo failed.
set -euo pipefail

log() { echo "[lore] $*"; }
die() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl not found"
command -v jq >/dev/null || die "jq not found"
[ -n "${LORE_API_URL:-}" ] || die "LORE_API_URL is not set"
[ -n "${LORE_ADMIN_TOKEN:-}" ] || die "LORE_ADMIN_TOKEN (an admin-scope token) is not set"
[ -n "${UTOPIA_API_URL:-}" ] || die "UTOPIA_API_URL is not set"
[ -n "${UTOPIA_SESSION_TOKEN:-}" ] || die "UTOPIA_SESSION_TOKEN (a knowledge-base admin's session token) is not set"

apply=0
repos=()
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    -*) die "unknown option $arg" ;;
    *) repos+=("$arg") ;;
  esac
done

api="${LORE_API_URL%/}/api"
utopia="${UTOPIA_API_URL%/}/api/v1"
lore_auth="Authorization: Bearer $LORE_ADMIN_TOKEN"
utopia_auth="Authorization: Bearer $UTOPIA_SESSION_TOKEN"
page_size=200

onboarded_repos() {
  local offset=0 page total
  while :; do
    page="$(curl -fsS -H "$lore_auth" "$api/repos?limit=100&offset=$offset")" ||
      die "GET /api/repos failed"
    jq -r '.repos[].full_name' <<<"$page"
    total="$(jq -r '.total' <<<"$page")"
    offset=$((offset + 100))
    [ "$offset" -lt "$total" ] || break
  done
}

# One call to Utopia: the body on a 2xx, else why not. A 3xx is the sign-in gate
# in front of the public address, which no token gets through.
utopia_call() {
  local method="$1" url="$2" out status
  out="$(mktemp)"
  status="$(curl -sS -m 120 -o "$out" -w '%{http_code}' -X "$method" -H "$utopia_auth" "$url")" || status="000"
  case "$status" in
    2??) cat "$out" ;;
    3??)
      log "Utopia answered $status, a redirect to a sign-in: UTOPIA_API_URL is the public address behind the gate; point it at a port-forward to the utopia service (kubectl -n utopia port-forward svc/utopia 1516:80)" >&2
      rm -f "$out"
      return 1
      ;;
    *)
      log "Utopia $method $url answered HTTP $status: $(head -c 200 "$out")" >&2
      rm -f "$out"
      return 1
      ;;
  esac
  rm -f "$out"
}

# One page of the old source's documents: live ones, or with state=deleted the
# tombstones that still hold their content.
old_documents() {
  local kb="$1" source="$2" state="$3"
  utopia_call GET \
    "$utopia/kbs/$kb/documents?source=$source&limit=$page_size&offset=0${state:+&state=$state}"
}

# Deletes (a live document only) and purges every document the listing returns,
# until it returns none or none of a page could be purged. Prints the count purged.
purge_state() {
  local kb="$1" source="$2" state="$3" purged=0 page ids id
  while :; do
    page="$(old_documents "$kb" "$source" "$state")" || return 1
    ids="$(jq -r '.docs[].id' <<<"$page")"
    [ -n "$ids" ] || break
    local before=$purged
    while read -r id; do
      [ -n "$state" ] || utopia_call DELETE "$utopia/documents/$id" >/dev/null || continue
      utopia_call POST "$utopia/documents/$id/purge" >/dev/null || continue
      purged=$((purged + 1))
    done <<<"$ids"
    [ "$purged" -gt "$before" ] || return 1
  done
  echo "$purged"
}

count_state() {
  old_documents "$1" "$2" "$3" | jq -r '.total'
}

# A walk of issues and pull requests reads at most this many entries, and the
# backfill runs one: walk again until one comes back short, so a repo with more
# than 200 starts with all of them and not 200 a week.
tracker_page=200

catch_up_tracker() {
  local repo="$1" out entries walks=0
  while [ "$walks" -lt 500 ]; do
    out="$(curl -fsS -m 1800 -X POST -H "$lore_auth" "$api/repos/$repo/utopia/tracker")" || {
      log "$repo: tracker walk failed"
      return 1
    }
    walks=$((walks + 1))
    if [ "$(jq '.failed | length' <<<"$out")" -ne 0 ]; then
      log "$repo: tracker walk $walks: $(jq -r '.failed[0]' <<<"$out")"
      return 1
    fi
    entries="$(jq -r '.entries' <<<"$out")"
    [ "$entries" -ge "$tracker_page" ] || break
  done
  log "$repo: tracker caught up after $walks walks"
}

split_repo() {
  local repo="$1" record kb source live deleted purged_live purged_deleted out status
  record="$(curl -fsS -H "$lore_auth" "$api/repos/$repo")" || {
    log "$repo: could not read it from Lore"
    return 1
  }
  kb="$(jq -r '.settings.utopia.kb_id // empty' <<<"$record")"
  source="$(jq -r '.settings.utopia.source_id // empty' <<<"$record")"
  if [ -z "$kb" ] || [ -z "$source" ]; then
    log "$repo: skipped, no Utopia knowledge base"
    return 0
  fi
  live="$(count_state "$kb" "$source" "")" || { log "$repo: could not list the old source"; return 1; }
  deleted="$(count_state "$kb" "$source" deleted)" || { log "$repo: could not list the old source"; return 1; }
  if [ "$apply" -eq 0 ]; then
    log "$repo: would purge $live live and $deleted deleted documents of source $source, reset and backfill"
    return 0
  fi
  log "$repo: purging $live live and $deleted deleted documents of source $source"
  purged_live="$(purge_state "$kb" "$source" "")" || { log "$repo: purge of live documents failed"; return 1; }
  purged_deleted="$(purge_state "$kb" "$source" deleted)" || { log "$repo: purge of deleted documents failed"; return 1; }
  log "$repo: purged $purged_live + $purged_deleted"
  out="$(mktemp)"
  status="$(curl -sS -m 120 -o "$out" -w '%{http_code}' -X POST -H "$lore_auth" "$api/repos/$repo/utopia/reset")" || status="000"
  [ "$status" = "200" ] || { log "$repo: reset HTTP $status $(head -c 300 "$out")"; rm -f "$out"; return 1; }
  log "$repo: reset, $(jq -r '.ingest_state_cleared' "$out") stored ingest commits forgotten"
  status="$(curl -sS -m 1800 -o "$out" -w '%{http_code}' -X POST -H "$lore_auth" "$api/repos/$repo/utopia/backfill")" || status="000"
  case "$status" in
    200)
      log "$repo: backfill: $(jq -r '"\(.documents) documents, \(.failed | length) failed"' "$out")"
      jq -r '.failed[] | "[lore]   failed: \(.)"' "$out"
      [ "$(jq '.failed | length' "$out")" -eq 0 ] || { rm -f "$out"; return 1; }
      ;;
    *) log "$repo: backfill HTTP $status $(head -c 300 "$out")"; rm -f "$out"; return 1 ;;
  esac
  rm -f "$out"
  catch_up_tracker "$repo"
}

[ "${#repos[@]}" -gt 0 ] || mapfile -t repos < <(onboarded_repos)
[ "$apply" -eq 1 ] || log "Dry run: pass --apply to purge"
problems=0
for repo in "${repos[@]}"; do
  [ -z "$repo" ] || split_repo "$repo" || problems=1
done

[ "$problems" -eq 0 ] || die "some repos were not moved"
log "Done. Tests and code reach test-coverage on each repo's next CI run."
