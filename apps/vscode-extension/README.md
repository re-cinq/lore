# Lore — spec ↔ code

Highlights source lines that fulfil a spec statement and links them to the
**local** spec, tests, and ADRs (never a browser). Part of the Lore platform.

- **In a source/test file** — lines linked from a spec are highlighted in two
  layers: blue *implemented* (author-linked `([code](file#Lnn))` in a spec.md)
  and green *covered* (a spec-linked test exercises them, from the remote
  trace graph). Hover for the statement text + links to open the spec/tests.
- **In a `spec.md`** — each statement carrying inline links gets a CodeLens to
  jump to its tests/code. A spec opened from a hover or lens link opens in VS
  Code's editable markdown preview.
- **Right-click → Lore: What does this do?** — explains the selected lines (or
  the cursor's line) in at most two paragraphs, grounded in the spec
  statements linked to them. A spinner shows in the gutter while it works,
  then a hint icon whose hover shows the answer; the answer is cached, so
  unchanged code keeps its hint after a restart. With no linked
  statement it says it does not know (`specs/explain-code/spec.md`).

## Install

`scripts/install.sh` builds the extension from the Lore checkout and installs
it into every editor CLI on `PATH` (`code`, `code-insiders`, `cursor`,
`codium`); the `lore_update` MCP tool (`scripts/lore-update.sh`) reinstalls it
whenever its sources change. Both run `scripts/lore-vscode-install.sh`, which
does nothing when no editor CLI is found. Set `LORE_SKIP_VSCODE=1` to opt out.
Reload the VS Code window after an update.

## Configuration

The extension reads `git config --global lore.api-url` and `lore.ingest-token`
by default (set by `install.sh`). Override per-window with the `lore.apiUrl` /
`lore.token` settings. Without credentials it still works offline from local
specs — only the coverage layer needs the remote graph.

| Command | What it does |
|---|---|
| `Lore: Refresh spec ↔ code links` | Rebuild the index now |
| `Lore: Toggle spec highlights` | Show/hide the decorations |
| `Lore: What does this do?` | Explain the selected code from its specs |

## Develop

```bash
npm install          # from the repo root (workspace member)
npm run build -w lore-vscode
npm test -w lore-vscode
npm run package -w lore-vscode   # writes lore-vscode.vsix
```

Press **F5** in VS Code to launch the Extension Development Host.
