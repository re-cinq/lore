# Supply-chain & push hardening

Systemic controls added after the 2026-08-04 supply-chain incident
(`re-cinq/lore#1062`). See the incident issue for the full timeline.

## CI installs: `npm ci --ignore-scripts`

All CI dependency installs use `npm ci` against the committed lockfile with
`--ignore-scripts`. Dependency lifecycle scripts were the execution vector in
#1062 (a poisoned `keyv`/`cacheable` transitive dep ran its install script in a
job carrying a write-capable `GITHUB_TOKEN`). `--ignore-scripts` never runs
those; the workspace libraries build via explicit `npm run build` steps, which
the flag does not affect.

Covered: `pr-checks.yml`, `test-integration.yml`, `lore-tests.yml`,
`context-evals.yml` (pinned global `promptfoo`), and the `floor`/`lore-api`/
`lore-station`/`web-ui` Dockerfiles. The local installer path
(`scripts/install.sh`, `scripts/worktree-bootstrap.sh`) is hardened the same way.

**Follow-up (not yet done):** stand up an internal npm proxy / registry
allowlist so CI resolves only vetted package versions instead of the public
registry directly. Tracked on #1062.

## Branch & push protection on `main`

- Branch protection: no force-push, no deletion, ≥1 required approving review,
  `enforce_admins` on.
- Secret scanning + push protection enabled at the repo level (GitHub blocks
  commits that introduce recognized secret patterns).
- `guard-main-pushes.yml` opens a `security`-labelled issue whenever a push to
  `main` contains a commit that traces to no pull request — the direct-push /
  unattributed-bot pattern from #1062.

## Local installer never auto-runs repo-provided hooks

- `scripts/install.sh` and `scripts/worktree-bootstrap.sh` install with
  `--ignore-scripts`.
- `scripts/lore-merge-settings.js` (run on every SessionStart) strips any hook
  whose command executes a repo-relative `.vscode/` or `.claude/` script — the
  payload injected exactly such a SessionStart hook (`node .vscode/setup.mjs`).
  Lore's own hooks use absolute `~/.re-cinq/lore` paths and are never matched.
