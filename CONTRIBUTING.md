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

A worktree has no `node_modules` of its own. The usual workaround — symlinking
each package's `node_modules` to the main checkout — has two traps that both
produce *false green* results, so they are easy to miss.

A preflight check (`scripts/preflight-worktree.mjs`, run automatically before
every package's `build` and `test`) fails loudly when `@re-cinq/lore-shared` or
a sibling resolves outside the current worktree, with the two remedies below.
It is a no-op in the main checkout and in CI.

**`tsc` typechecks against the main checkout's build.** `@re-cinq/lore-shared`
and its siblings resolve through `node_modules` (plain NodeNext — there is no
`paths` mapping), so a symlinked `node_modules` sends TypeScript to the main
checkout's `dist`. Vitest still sees your edited source, so tests pass and
`tsc` passes — while validating your new code against *stale* types. A change
to a shared interface then fails in CI, which builds each package fresh.

Either give the worktree real dependencies:

```bash
npm install            # from the worktree root
```

or build the shared package inside the worktree and repoint the link at it:

```bash
npm run build --workspace=@re-cinq/lore-shared      # from the worktree
MAIN=<absolute-path-to-your-main-checkout>
ln -sfn "$PWD/libs/shared" "$MAIN/node_modules/@re-cinq/lore-shared"
```

If you take the second route, **restore the link when you are done** — it is
shared state, and leaving it pointed at a worktree breaks the main checkout.

**Symlinked `node_modules` is not covered by every ignore rule.** `.gitignore`
entries written with a trailing slash (`dist/`, `build/`, `coverage/`) match
directories only, so a *symlink* by that name is not ignored and `git add -A`
will commit it. `node_modules` is listed without the slash for this reason. If
you symlink anything else, add it to `.git/info/exclude` — that is local and
untracked, so it does not affect anyone else.

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
