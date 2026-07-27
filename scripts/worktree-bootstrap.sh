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

libs=(libs/shared libs/assembly-lines libs/server-core)
stale=()

for lib in "${libs[@]}"; do
  built="$lib/dist/index.js"

  if [[ ! -f $built || -n "$(find "$lib/src" -newer "$built" -print -quit)" ]]; then
    stale+=("$lib")
  fi
done

if [[ ${#stale[@]} -gt 0 ]]; then
  say "worktree-bootstrap: building workspace libs (stale: ${stale[*]})"
  npm run build --workspace=@re-cinq/lore-shared
  npm run build --workspace=@re-cinq/lore-assembly-lines
  npm run build --workspace=@re-cinq/lore-server-core
  say "worktree-bootstrap: done — eslint and tsc now resolve inside $root"
fi
