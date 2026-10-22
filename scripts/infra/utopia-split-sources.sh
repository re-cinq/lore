#!/usr/bin/env bash
# Move an onboarded repo's Utopia knowledge base from the one `lore` source to a
# source per kind (specs/utopia-graph-mirror FR19, ADR-052 amendment 2026-10-22).
#
#   LORE_API_URL=https://lore.example LORE_ADMIN_TOKEN=... \
#   UTOPIA_API_URL=http://127.0.0.1:1516 UTOPIA_SESSION_TOKEN=... \
#     ./scripts/infra/utopia-split-sources.sh [--apply] [owner/repo ...]
#
# Run it once migration 0116 is live: from then on a repo's `test-coverage` source
# IS its old `lore` source, which already holds the statement, test and code items,
# so nothing is purged (a delete and a purge cost Utopia seconds each, a pass over
# the whole base's facts per document). Without --apply it only says what it would
# do. With --apply, per repo, one at a time:
#   1. names the old `lore` source `test-coverage`, first setting aside as
#      `test-coverage-unused` any other source of that name (the one a push made
#      before 0116, which keeps what it holds and is no longer pushed to);
#   2. resets the repo (POST /utopia/reset): the commit and tracker walks start over;
#   3. runs the backfill, which fills `docs`, `git-history` and `github`, then walks
#      the issues and pull requests until one walk comes back short.
# Nothing is deleted. The issue, commit, pull request, tag, release and document
# items the old source holds stay in it, no longer pushed to.
#
# UTOPIA_SESSION_TOKEN is the `utopia_token` session JWT of a knowledge-base editor:
# Utopia's source routes refuse a personal access token. Repos are done one at a
# time; a repo that failed is reported and the run exits 1.
set -euo pipefail

log() { echo "[lore] $*"; }
die() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl not found"
command -v jq >/dev/null || die "jq not found"
[ -n "${LORE_API_URL:-}" ] || die "LORE_API_URL is not set"
[ -n "${LORE_ADMIN_TOKEN:-}" ] || die "LORE_ADMIN_TOKEN (an admin-scope token) is not set"
[ -n "${UTOPIA_API_URL:-}" ] || die "UTOPIA_API_URL is not set"
[ -n "${UTOPIA_SESSION_TOKEN:-}" ] || die "UTOPIA_SESSION_TOKEN (a knowledge-base editor's session token) is not set"

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
  local method="$1" url="$2" json="${3:-}" out status
  local args=(-sS -m 120 -X "$method" -H "$utopia_auth")
  [ -z "$json" ] || args+=(-H 'Content-Type: application/json' --data "$json")
  out="$(mktemp)"
  status="$(curl "${args[@]}" -o "$out" -w '%{http_code}' "$url")" || status="000"
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

# Names the old source `test-coverage`. A source already called that, other than
# the old one, is set aside first, so the base never holds two of one name.
name_test_coverage() {
  local repo="$1" kb="$2" old="$3" sources aside id
  sources="$(utopia_call GET "$utopia/kbs/$kb/sources")" || return 1
  if [ "$(jq -r --arg old "$old" '[(.sources // .)[] | select(.id == $old) | .name][0] // ""' <<<"$sources")" = "test-coverage" ]; then
    log "$repo: source $old is already named test-coverage"
    return 0
  fi
  aside="$(jq -r --arg old "$old" '(.sources // .)[] | select(.name == "test-coverage" and .id != $old) | .id' <<<"$sources")"
  if [ "$apply" -eq 0 ]; then
    log "$repo: would name source $old test-coverage${aside:+, setting aside $(wc -w <<<"$aside" | tr -d ' ') other source of that name}"
    return 0
  fi
  for id in $aside; do
    utopia_call PATCH "$utopia/kbs/$kb/sources/$id" '{"name":"test-coverage-unused"}' >/dev/null || return 1
    log "$repo: set aside source $id as test-coverage-unused"
  done
  utopia_call PATCH "$utopia/kbs/$kb/sources/$old" '{"name":"test-coverage"}' >/dev/null || return 1
  log "$repo: named source $old test-coverage"
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
  local repo="$1" record kb source out status
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
  name_test_coverage "$repo" "$kb" "$source" || return 1
  [ "$apply" -eq 1 ] || {
    log "$repo: would reset the walk cursors and backfill"
    return 0
  }
  out="$(mktemp)"
  status="$(curl -sS -m 120 -o "$out" -w '%{http_code}' -X POST -H "$lore_auth" "$api/repos/$repo/utopia/reset")" || status="000"
  [ "$status" = "200" ] || { log "$repo: reset HTTP $status $(head -c 300 "$out")"; rm -f "$out"; return 1; }
  log "$repo: reset, cursors dropped: $(jq -r '.cursors_cleared | join(", ")' "$out")"
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
[ "$apply" -eq 1 ] || log "Dry run: pass --apply to rename, reset and backfill"
problems=0
for repo in "${repos[@]}"; do
  [ -z "$repo" ] || split_repo "$repo" || problems=1
done

[ "$problems" -eq 0 ] || die "some repos were not moved"
log "Done."
