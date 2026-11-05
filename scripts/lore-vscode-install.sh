#!/usr/bin/env bash
#
# lore-vscode-install.sh — build the Lore VS Code extension from the installed
# checkout and install it into every editor CLI found on PATH.
#
# Run by install.sh and lore-update.sh (so the lore_update MCP tool installs it
# too). Never runs dependency install scripts: lore-update.sh / install.sh
# already did `npm ci --ignore-scripts`.
#
# Idempotent: skips the build when the extension's sources have not changed
# since the last install and the editor still lists it.
# Opt out with LORE_SKIP_VSCODE=1.

set -uo pipefail

say() { echo "[lore] $*"; }

LORE_DIR="${LORE_DIR:-$HOME/.re-cinq/lore}"
MARKER="$HOME/.lore/vscode-build-head"
EXTENSION_ID="re-cinq.lore-vscode"
EXTENSION_DIR="$LORE_DIR/apps/vscode-extension"

if [[ "${LORE_SKIP_VSCODE:-}" == "1" ]]; then
  say "vscode: skipped (LORE_SKIP_VSCODE=1)"
  exit 0
fi

editors=()
for cli in code code-insiders cursor codium; do
  command -v "$cli" >/dev/null 2>&1 && editors+=("$cli")
done

if [[ ${#editors[@]} -eq 0 ]]; then
  say "vscode: no editor CLI (code, code-insiders, cursor, codium) on PATH — skipping the extension"
  exit 0
fi

source_head="$(git -C "$LORE_DIR" log -1 --format=%H -- apps/vscode-extension libs/shared/src 2>/dev/null)"
installed_head="$(cat "$MARKER" 2>/dev/null || true)"

missing=()
for cli in "${editors[@]}"; do
  "$cli" --list-extensions 2>/dev/null | grep -qix "$EXTENSION_ID" || missing+=("$cli")
done

if [[ -n "$source_head" && "$source_head" == "$installed_head" && ${#missing[@]} -eq 0 ]]; then
  say "vscode: extension up to date (${source_head:0:8})"
  exit 0
fi

say "vscode: building the Lore extension ..."
cd "$LORE_DIR" || exit 1
npm run build -w lore-vscode >/dev/null 2>&1 || { say "vscode: build failed (npm run build -w lore-vscode)"; exit 1; }
npm run package -w lore-vscode >/dev/null 2>&1 || { say "vscode: packaging failed (npm run package -w lore-vscode)"; exit 1; }

for cli in "${editors[@]}"; do
  if "$cli" --install-extension "$EXTENSION_DIR/lore-vscode.vsix" --force >/dev/null 2>&1; then
    say "vscode: installed into $cli — reload the window to load it"
  else
    say "vscode: install into $cli failed"
    exit 1
  fi
done

mkdir -p "$(dirname "$MARKER")"
echo "$source_head" > "$MARKER"
