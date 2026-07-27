# Contributing

For a full local-development walkthrough — running the whole stack, the project
layout, the tech stack, and design principles — see
[docs/building-lore/contributing.md](docs/building-lore/contributing.md). This
file covers the quick start, code conventions, and the PR checklist.

## Getting Started

Run the install script once to set up your environment:

```bash
scripts/install.sh
```

This configures the MCP server, skills, hooks, and agent ID.

## Development Workflow

Use the `/lore-feature` skill to start or continue implementing a feature:

```
/lore-feature
```

It guides you through spec → plan → tasks → implementation interactively.

## Working in a git worktree

A fresh worktree has no `node_modules` and no built workspace libs, so module
resolution walks up out of the worktree into the main checkout's (possibly
stale) install. The symptom mutates with whatever that install happens to be
missing ([#950](https://github.com/re-cinq/lore/issues/950)):

- **`npx eslint` crashes on load.** The repo eslint plugin imports
  `@re-cinq/lore-shared` (a *built* workspace lib), so a missing install or
  unbuilt `libs/shared/dist` fails the whole run — as does any dependency the
  escaped-to install lacks (e.g. `@eslint/markdown`).
- **`tsc` typechecks against the main checkout's build.** `@re-cinq/lore-shared`
  and its siblings resolve through `node_modules` (plain NodeNext — no `paths`
  mapping) to the main checkout's `dist`. Vitest still sees your edited source,
  so tests pass and `tsc` passes — while validating against *stale* types
  (false green; CI then fails because it builds each package fresh).

Bootstrap the worktree once:

```bash
scripts/worktree-bootstrap.sh   # npm ci + build libs/{shared,assembly-lines,server-core}
```

Claude Code sessions run it automatically via the SessionStart hook in
`.claude/settings.json`; run it yourself in worktrees created by hand. It is
idempotent — on a bootstrapped checkout it is an instant no-op.

One caveat remains: `tsc` resolves workspace libs through their built `dist`.
After editing `libs/*/src`, rerun `scripts/worktree-bootstrap.sh` (it rebuilds
only stale libs) before trusting a package-level `npx tsc --noEmit`.

Do **not** symlink a worktree's `node_modules` to the main checkout, and do
not repoint the main checkout's `@re-cinq/*` links at a worktree — both
reintroduce the stale-resolution disease, the second for every other checkout
on the machine. If you do symlink something, note that `.gitignore` entries
with a trailing slash (`dist/`, `coverage/`) match directories only — a
*symlink* by that name is not ignored and `git add -A` will commit it; add it
to `.git/info/exclude`, which stays local and untracked.

## Code Conventions

See [CLAUDE.md](CLAUDE.md) for full conventions. Quick summary:

- **TypeScript**: ESM modules, strict mode, Zod validation on MCP tools
- **Python**: glue scripts only, keep under 100 lines
- **Bash**: idempotent scripts, prefix output with `[lore]`
- No long-lived credentials — use Workload Identity or `gcloud auth`

## Submitting PRs

A PR template is included in `.github/pull_request_template.md`. Fill it out
before requesting review. Use the `/lore-pr` skill to draft a description from
your spec and changed files:

```
/lore-pr
```

PRs for implementation tasks are typically created automatically by the Lore
Agent. Human PRs follow the same template and conventions.
