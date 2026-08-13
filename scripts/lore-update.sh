#!/usr/bin/env bash
#
# lore-update.sh — pull + rebuild the installed local MCP adapter, safely.
#
# Invoked by the `lore_update` MCP tool (on explicit user consent) and re-usable
# by hand. It is the ONLY place the local MCP is updated, so the security
# properties live in one audited script:
#   - `npm ci --ignore-scripts`: dependency lifecycle scripts are the #1062
#     keyv/cacheable supply-chain vector — never run them. Lore's own workspaces
#     build via the explicit `npm run build` below, which --ignore-scripts does
#     not affect.
#   - Headless git + npm + tsc only. It never opens the folder or executes any
#     repo-provided autorun (`.vscode/tasks.json`, project `.claude/settings.json`
#     SessionStart hooks).
#
# PRECONDITION (not enforced here): `main` should be branch-protected +
# push-protected before relying on auto-pull — otherwise a malicious *direct*
# push to `main` is what gets rebuilt and run locally. Tracked in re-cinq/lore#1062.
#
# Idempotent: a no-op when HEAD is unchanged and dist is fresh.

set -uo pipefail

say() { echo "[lore] $*"; }

LORE_DIR="${LORE_DIR:-$HOME/.re-cinq/lore}"
MARKER="$HOME/.lore/mcp-build-head"

if [[ ! -d "$LORE_DIR/.git" ]]; then
  say "lore-update: no checkout at $LORE_DIR — run scripts/install.sh first"
  exit 1
fi

cd "$LORE_DIR"

# --- single-run lock (mkdir is atomic; 10-min stale takeover) -----------------
lock="$LORE_DIR/.lore-update.lock"
tries=0
until mkdir "$lock" 2>/dev/null; do
  tries=$((tries + 1))
  [[ $tries -eq 1 ]] && say "lore-update: another run holds the lock — waiting"
  if [[ $tries -gt 120 ]]; then
    say "lore-update: lock stale after 10 minutes — taking over"
    rmdir "$lock" 2>/dev/null || true
  fi
  sleep 5
done
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

# --- pull (fast-forward only) -------------------------------------------------
OLD="$(git rev-parse HEAD 2>/dev/null || echo none)"
git -c http.timeout=15 pull --quiet --ff-only 2>/dev/null || say "lore-update: git pull failed (offline?) — building current checkout"
NEW="$(git rev-parse HEAD 2>/dev/null || echo none)"

# --- staleness gate: rebuild iff HEAD moved, dist missing, or src newer --------
adapter_dist="$LORE_DIR/apps/mcp-server/dist/index.js"
needs_build=0
[[ "$OLD" != "$NEW" ]] && needs_build=1
[[ ! -f "$adapter_dist" ]] && needs_build=1
for src in libs/shared/src libs/server-core/src apps/mcp-server/src; do
  built="${src%/src}/dist/index.js"
  if [[ ! -f "$built" || -n "$(find "$src" -newer "$built" -print -quit 2>/dev/null)" ]]; then
    needs_build=1
    break
  fi
done

if [[ $needs_build -eq 0 ]]; then
  say "lore-update: already up to date ($NEW) — nothing to build"
  echo "$NEW" > "$MARKER" 2>/dev/null || true
  exit 0
fi

# --- install deps only when the lockfile changed (never run install scripts) --
if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]] 2>/dev/null; then
  say "lore-update: installing workspace dependencies (npm ci --ignore-scripts)"
  npm ci --ignore-scripts --silent 2>&1 \
    || npm install --ignore-scripts --silent 2>&1 \
    || { say "lore-update: npm install failed"; exit 1; }
fi

# --- build the minimal MCP chain: shared -> server-core -> mcp ----------------
say "lore-update: building shared + server-core + MCP adapter ..."
if npm run build -w @re-cinq/lore-shared -w @re-cinq/lore-server-core -w @re-cinq/lore-mcp 2>&1; then
  mkdir -p "$(dirname "$MARKER")"
  echo "$NEW" > "$MARKER"
  say "lore-update: rebuilt to $NEW — restart Claude Code to load it"
  exit 0
else
  say "lore-update: build failed"
  exit 1
fi
