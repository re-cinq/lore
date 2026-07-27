#!/usr/bin/env bash
#
# worktree-bootstrap.sh — make a checkout self-sufficient for repo tooling (#950).
#
# A fresh `git worktree` has no node_modules and no built workspace libs, so
# Node/TS module resolution walks up out of the worktree into the main
# checkout's (possibly stale) install. The symptom mutates with whatever that
# install happens to be missing: `npx eslint` crashes loading
# tools/eslint-plugin-lore (missing `@re-cinq/lore-shared/dist/*` — or, with
# an older main install, a missing dependency like `@eslint/markdown`), and
# `tsc` typechecks against the main checkout's dist while vitest sees the
# worktree's source — false green.
#
# Idempotent: installs only when node_modules is absent, rebuilds the
# workspace libs only when their src is newer than their dist. A bootstrapped
# checkout is an instant no-op, so the .claude/settings.json SessionStart
# hook runs this on every session.

set -euo pipefail

say() { echo "[lore] $*"; }

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [[ ! -f package-lock.json ]]; then
  say "worktree-bootstrap: no package-lock.json at $root — nothing to do"
  exit 0
fi

lock="$root/.lore-bootstrap.lock"
tries=0

until mkdir "$lock" 2>/dev/null; do
  tries=$((tries + 1))

  if [[ $tries -eq 1 ]]; then
    say "worktree-bootstrap: another run holds $lock — waiting"
  fi

  if [[ $tries -gt 120 ]]; then
    say "worktree-bootstrap: lock stale after 10 minutes — taking over"
    rmdir "$lock" 2>/dev/null || true
  fi

  sleep 5
done
trap 'rmdir "$lock"' EXIT

if [[ ! -d node_modules ]]; then
  say "worktree-bootstrap: installing dependencies in $root (npm ci, first run only)"
  npm ci --no-audit --no-fund
fi

# Dependency order: assembly-lines and server-core both import shared, so a
# stale lib forces a rebuild of everything after it in this list too.
libs=(libs/shared libs/assembly-lines libs/server-core)
workspaces=(@re-cinq/lore-shared @re-cinq/lore-assembly-lines @re-cinq/lore-server-core)
stale=()
first_stale=-1

for i in "${!libs[@]}"; do
  lib=${libs[$i]}
  built="$lib/dist/index.js"

  if [[ ! -f $built || -n "$(find "$lib/src" -newer "$built" -print -quit)" ]]; then
    stale+=("$lib")

    if [[ $first_stale -lt 0 ]]; then
      first_stale=$i
    fi
  fi
done

if [[ $first_stale -ge 0 ]]; then
  say "worktree-bootstrap: rebuilding ${workspaces[*]:$first_stale} (stale: ${stale[*]})"

  for workspace in "${workspaces[@]:$first_stale}"; do
    npm run build --workspace="$workspace"
  done

  say "worktree-bootstrap: done — eslint and tsc now resolve inside $root"
fi
