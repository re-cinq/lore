# Lore Shared (`@re-cinq/lore-shared`)

The widest workspace library — the code with **multiple consumers**. The Floor,
lore-api, server-core, the station pods, and the mcp-server all import from
here; anything used by more than one app lands in a domain-named module in this
package rather than being duplicated (or dumped in a junk drawer). The package
exposes **narrow subpath exports** (`./models/*.js`, `./project/*.js`,
`./llm/*.js`, `./lib/*.js`, ...) precisely so a light runtime — a station pod,
the MCP adapter, web-ui — can import one pure module without dragging the heavy
dependencies (octokit, pg, tree-sitter, GCS) into its image. See
[ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md) ("Floor
data access") and [ADR-032](../../adrs/ADR-032-split-local-remote-api.md) for
why the boundary sits here.

## Major domains

### `src/models/` — every persisted shape, once

The **single source of truth** for every table the platform persists (32
entities, one file each). A model file holds three things: the **Zod schema**,
the **type inferred from it**, and a **`ColumnMap`** binding each camelCase
field to the snake_case column that stores it. Adapters build their SELECT
lists with `selectList()` and map rows with `fromRow()` (`src/lib/row.ts`);
API contracts derive their stored wire shapes with `wireSchema()`
(`src/lib/wire-schema.ts`) — one declaration reaches from the column to the
generated web-ui type. `models.test.ts` discovers the folder rather than
taking a registry, and fails on any model whose schema will not resolve.

### `src/project/` — the Project facade

The unified per-repo API ([ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md)):
one `Project` object over ~11 ports, each with a **Pg adapter** and an
**in-memory double** — tasks queue (`tasks/task-queue-*`), events queue
(`events/event-queue-*`), leases (`leases/lease-backends.ts` —
`DbLeaseBackend` atomic CTE acquire + `FileLeaseBackend` for worktree mode),
agent-run-events, issues, pulls, settings, memory, chunks, and more. The
barrel (`project/index.ts`) is **pure surface only**: adapters are reached by
deep import so light runtimes can use the types without the heavy deps.
`project/lib/platform-github.ts` is the **only production octokit importer**
in the repo — every GitHub read/write flows through the `GitHubPort` /
`PullRequestsPort` it implements. `createStationProject` (`lib/station-http.ts`)
is the HTTP-backed variant station pods use so no Postgres or App credential
ever rides in a pod.

### `src/llm/` — the provider abstraction

The `Llm` singleton (`llm.ts`) over vendor providers — `anthropic-provider.ts`
(with the two-breakpoint **prompt caching** from `prompt-cache.ts`:
`getCacheControl(jobName)`, prefix hashing, cache-break classification),
openai, ollama, a CLI fallback, `fake-llm.ts` for tests, and the `NoLlm`
guard that fails loudly when no credential is configured.

### `src/detect/` — the detector cores

The deterministic detection-family logic (`gap-detect`, `spec-drift`,
`spec-coverage-validate`, `spec-coverage-backfill`) shared by the Floor's
fan-out handlers and the `lore-station` detect pods — facade-driven, so both
callers run the same core.

### The pure modules

Small, dependency-light modules with more than one consumer. The load-bearing
ones:

- **`lib/enforce.ts`** — the D-style precondition guard
  (`@re-cinq/lore-shared/lib/enforce.js`), preferred over if-throw blocks.
- **`spec-segment.ts` / `spec-link-parser.ts`** — the spec-traceability
  parsing (`([validated by ...])` inline links) used by CI, the web UI's
  trace graph, and the eslint rules.
- **`commit-trailers.ts` / `pr-body.ts`** — the `Lore-Task:` / `Lore-Stage:`
  audit substrate on every Lore-authored commit and PR.
- **`path-match.ts`** — `allPathsMatch()`, the auto-merge allowlist gate.
- **`business-hours.ts`** — the IANA-TZ-aware gate for safety crons.
- **`test-command-manifest.ts`** — the `.lore/test-commands.yml` schema and
  resolver (project-test-interface).
- **`dark-factory-settings.ts`** — the dependency-free settings resolver
  (web-ui reaches it by relative path; the input-validation schema lives in
  lore-api, the shape in `models/`).
- **`repo-validation/`** — deterministic lint/typecheck detection for
  Node/Go/Python/Rust.

Also here: `http/` (bearer/HMAC/raw-body helpers), `db/pg-pool.ts`,
`cluster/` (the cluster-agent client + ports), `escalation/`,
`feature-planning/`, `review/`, and the memory/embedding stores.

## Testing

Tests are **colocated** (`*.test.ts` next to the source, vitest). The
in-memory port doubles are not conveniences — they are the **behavioral
spec**: the Pg adapter and the double run the same test suite, so a behavior
change must land in both.

**Worktree gotcha**: vitest reads source, but dependents' `tsc` reads `dist/`.
After editing `libs/shared/src`, rebuild (`npm run build -w
@re-cinq/lore-shared`, or rerun `scripts/worktree-bootstrap.sh`) or package
typechecks will judge stale types. Note `npm test` here also picks up compiled
tests under `dist/` — build before trusting green.

## What does not belong here

- **App-specific logic** — a job only the Floor runs, a route only lore-api
  serves, stays in its app. Code moves here when it gains a second consumer,
  not before.
- **Junk-drawer modules** — no `utils/`, `misc/`, or `helpers/`. Every module
  is named for the domain it owns; if a helper has no domain, it is probably
  dead weight.
- **Heavy deps on the main barrel** — the root export and `project/index.ts`
  must stay importable from light runtimes; octokit/pg/tree-sitter are reached
  only through deep imports or stay in `devDependencies` of the consumer.

## Develop

```bash
npm install                            # from the repo root (workspace member)
npm run build -w @re-cinq/lore-shared
npm test  -w @re-cinq/lore-shared
```

Nearly every workspace package depends on this one — the root `npm run build`
orders it first.
