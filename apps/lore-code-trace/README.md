# lore-code-trace

The portable **CI test-ingestion orchestrator** — the repo's first (and only) Go
module. It reads a repo's `.lore/test-commands.yml` manifest, runs the full test
suite through the manifest's `list`/`run` commands, normalizes coverage into
canonical line ranges, and prints the report — or, with `--post`, sends it to
the Floor's `POST /api/webhook/ci-tests` ingress, which feeds the
spec-traceability graph. It runs in each onboarded repo's `lore-tests.yml`
workflow on push to `main` (and in local dev sandboxes); it replaced the old
`npm run trace:run-tests` TypeScript CLI. See
[`specs/project-test-interface/`](../../specs/project-test-interface/spec.md)
(+ [`contracts/test-commands.md`](../../specs/project-test-interface/contracts/test-commands.md))
and [ADR-023](../../adrs/ADR-023-ci-driven-doc-and-test-projection.md).

## What it does

1. Resolves the git root, commit, branch, and `owner/repo` (from
   `remote.origin.url`).
2. Loads `.lore/test-commands.yml` and validates it: `list` and `run` are
   required, `run` must contain the `{selector}` placeholder,
   `coverage_format` must be `lcov|cobertura|json`. Optional: `cwd` (monorepo
   subdir, default `.`) and `path_prefix_strip`. A polyglot repo may declare a
   YAML array — **only the first entry is used**.
3. Runs `list` (a JSON array of `{id, name, file, startLine, endLine, suite?,
   spec?}` descriptors), then runs the `run` command **once per file** (4-way
   concurrent), substituting the file path for `{selector}`.
4. Parses each run's output by `coverage_format` — `json` expects
   `{passed, covered}` on stdout; `lcov` / `cobertura` are parsed **in the
   binary** into `{file, startLine, endLine}` ranges (the server never parses
   coverage formats). For lcov/cobertura the exit code is pass/fail and per-test
   `TN:` grouping is dropped — the file is the coverage granularity. A failed or
   unparseable per-file run is logged and skipped, never fatal.
5. Prints the `{commit, branch, tests, results}` report as JSON to stdout, or
   with `--post` splits it into ≤512KB chunks and POSTs each (plus the `repo`
   slug) to `$LORE_WEBHOOK_URL/api/webhook/ci-tests` with a bearer token.
   Transient failures (5xx, 429, transport errors) retry 3 times with backoff;
   a 4xx aborts immediately. Ingest is idempotent (xid upserts), so re-sending
   a chunk is safe.

## Flags

| Flag     | Effect                                                                                       |
| -------- | -------------------------------------------------------------------------------------------- |
| `--post` | POST the report to the Floor ci-tests ingress instead of printing it. Requires the env vars. |

There are no other flags. Exit code: `0` on success, `1` on any fatal error
(errors go to stderr, prefixed `lore-code-trace:`).

## Environment variables

| Variable               | Purpose                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `LORE_WEBHOOK_URL`     | Base URL of the Floor server (`--post` only, required). `/api/webhook/ci-tests` is appended.              |
| `LORE_INGEST_TOKEN`    | Bearer token for the ingest POST (`--post` only, required).                                               |
| `LORE_TRACE_TIMEOUT_MS`| Per-command timeout for `list` and each `run`, in ms. Default 120000. CI sets 600000 for cold runners.    |
| `LORE_DB_HOST`         | If set, the binary **refuses to run** — trust-boundary parity with the TS runner: repo commands execute only in a trusted sandbox (CI/local), never the shared server. |

## Run

```bash
cd /path/to/repo          # any repo with .lore/test-commands.yml
lore-code-trace           # print the report to stdout
LORE_WEBHOOK_URL=https://lore-floor.example.com \
LORE_INGEST_TOKEN=... \
lore-code-trace --post    # run + ingest
```

## Build

No Makefile or npm script — plain `go build`:

```bash
cd apps/lore-code-trace
go build -o lore-code-trace .
go test ./...
```

Release builds are cross-compiled in the **lore-api image**'s `gobuilder` stage
([`apps/lore-api/Dockerfile`](../lore-api/Dockerfile)) for
`linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64` with
`CGO_ENABLED=0 go build -ldflags="-s -w"`, plus a `checksums.txt`. The server
serves them unauthenticated at `GET /dist/lore-code-trace/<os>-<arch>`
(route: [`apps/lore-api/src/api/routes/dist/dist.ts`](../lore-api/src/api/routes/dist/dist.ts));
each repo's `lore-tests.yml` downloads the binary from there, verifies the
checksum, and runs it — so a change under `apps/lore-code-trace/**` must
rebuild + redeploy lore-api, or CI keeps downloading the old binary
(`build-lore-api.yml` path-filters on this directory for exactly that reason).

## Boundaries

- Runs the **whole suite** — no diff-scoped or single-test mode; per-file runs
  are the finest granularity, so every descriptor in a file shares that file's
  pass/fail + coverage.
- Only the **first** manifest entry of a polyglot list is honoured.
- Requires a git checkout with an `origin` remote (that is where the `repo`
  slug comes from) and a `sh` on PATH (commands run via `sh -c`).
- It orchestrates and normalizes only: descriptor↔spec binding, graph writes,
  and coverage semantics live server-side (`ingestTestReport`).
