# Feature Specification: Coverage Ingestion

> **⛔ Superseded by [`project-test-interface`](../project-test-interface/spec.md) (2026-06-05).** That spec absorbs this feature's bulk LCOV/Cobertura upload endpoint + parsers and adds the on-demand `tests.list`/`tests.run` command interface, feeding execution coverage into the [`spec-traceability-graph`](../spec-traceability-graph/spec.md) (`Coverage`/`COVERS` nodes) instead of the `coverage_lines`/`coverage_runs` tables proposed below. The wire format (LCOV primary, Cobertura secondary), the `POST /api/repos/:o/:r/coverage` endpoint, the path-filtering, and the per-language CI templates all carry over to `project-test-interface`. The relational `coverage_lines`/`coverage_runs` data model below is **not** implemented — coverage lives in the graph. Read this spec only for the LCOV/Cobertura parsing detail and the cross-language compatibility matrix, which remain accurate.

> **⚠️ (Historical) Deferred — decoupled from [`spec-test-coverage` v3](../spec-test-coverage/spec.md).** This spec was originally drafted to feed `coverage_hits` into the v2 BYO-compute `prepare_spec_link` endpoint (and the cron's candidate pre-filter). Both of those consumers are removed in v3. **The data model and ingestion endpoint below remain valid as a future input to v3's backfill cron** — when the cron is choosing which test to suggest for a statement, execution-trace evidence is the strongest possible signal, far better than name overlap + directory affinity + embedding cosine. But this feature is **not blocking v3** and there is no scheduled implementation date. Picking this up requires re-wiring the consumer in `agent/src/jobs/cron/spec-coverage-backfill.ts` (v3 file) to call `selectCandidates` with a new `coverage` match_kind. Everything else in the spec below holds; only the consumer changes.

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Coverage Ingestion                       |
| Status         | **Superseded by [`project-test-interface`](../project-test-interface/spec.md)** (2026-06-05) |
| Created        | 2026-06-02                               |
| Deferred       | 2026-06-02 — same day as v3 redesign     |
| Superseded     | 2026-06-05 — folded into `project-test-interface` |
| Owner          | Platform Engineering                     |
| Benefits       | [`spec-test-coverage` v3](../spec-test-coverage/spec.md) backfill cron (when implemented) — execution-trace evidence beats name-overlap guessing for the judge's candidate ranking |

## Problem Statement

The spec → test linker's candidate pre-filter ([`selectCandidates()` in
`agent/src/jobs/cron/spec-test-linker.ts`](../../agent/src/jobs/cron/spec-test-linker.ts))
relies on three signals — assertion overlap (string-match on symbol
names in test bodies), directory affinity (token overlap between spec
slug and test path), embedding proximity (cosine similarity). All
three are **guesses**:

- A test that imports `claimNextTask` but never calls it matches by
  assertion overlap and pollutes the candidate set.
- `local-runner.test.ts` and `specs/local-task-runner/spec.md` share
  4 tokens, so directory affinity flags it — even when the test
  actually exercises a different code path.
- Embedding proximity routinely surfaces tests that share vocabulary
  with a spec but validate unrelated behaviour.

This noise pushes work onto the LLM judge, costs API/subscription
tokens, and the judge itself can only reason from the test source +
the spec — it has no way to verify that the test actually executes the
code the spec describes.

**Code coverage data is the ground-truth answer to "did this test
exercise this code?"** It's an execution trace, not a textual hint.
Combined with the AST chunker's symbol line ranges already in
`{schema}.chunks.metadata`, coverage gives a deterministic
test → covered_symbol map. The linker currently has no access to it.

## Solution

A server-side ingestion path for coverage reports, language-agnostic
via **LCOV** as the canonical wire format (the de-facto cross-ecosystem
coverage format; nearly every test runner emits it natively or via a
one-step converter — see compatibility matrix in §Limitations). A
secondary parser handles **Cobertura XML** for the JVM stragglers
that don't pipe to LCOV cleanly.

One write endpoint:

```
POST /api/repos/:owner/:repo/coverage
  body: { format: "lcov"|"cobertura", commit: string,
          branch?: string, payload: string }
```

One per-team-schema table: `{schema}.coverage_lines` — one row per
(test_file, test_name, covered_file, line_range) tuple. Indexed for
the linker's two access patterns: "what does test T cover" and "what
covered file F."

The cron + webhook + local linker paths gain a new strongest signal:
**`match_kind = "coverage"`** (rank 4 in `KIND_RANK`, above
`assertion` at 3). A test whose coverage lines overlap a symbol the
spec names is the highest-confidence candidate possible — execution
trace, not inference. The judge's job collapses from "does this test
exercise the spec's behaviour" (a guess) to "which **statement** does
this test best validate" (the genuinely LLM-y part).

Per-language CI templates (added to the `onboard` task's output)
collect coverage on every test run and upload it via the endpoint.
The repo's existing CI pipeline does the language-specific work; Lore
sees only normalized LCOV/Cobertura.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wire format | **LCOV primary, Cobertura XML secondary** | LCOV is the de-facto cross-language coverage format; every major test runner emits it natively or via a one-step converter. Cobertura covers JVM tools whose LCOV path is awkward. Two parsers cover ~99% of real-world coverage tooling. |
| Format detection | **Caller declares via `format` field** | Saves a guess and the failure mode of an inferred parser. CI templates know what they emit. |
| Storage shape | **One row per `(test_file, test_name, covered_file, line_range)`** | Lets the linker join coverage to AST symbol ranges by `(covered_file, line)` without re-parsing on every read. |
| Retention | **Latest run per branch retained; runs older than 30 days pruned** | Coverage is per-commit; old commits are irrelevant for current linking. 30 days lets you investigate a regression. |
| Per-test attribution | **Use `TN:` tag when present; fall back to per-file aggregate `test_name = '*'`** | Some tooling tags coverage by test (Vitest, pytest-cov), others don't (Go's `-coverprofile`). Documenting the degradation is honest; the linker handles `'*'` as "any test in this file covers this code." |
| Idempotency | **Upsert on `(repo, commit, test_file, test_name, covered_file)`; replace previous rows for the same commit on re-upload** | CI retries / re-runs don't duplicate; the latest run for a commit wins. |
| Linker integration | **New `match_kind = "coverage"`**, rank 4 (highest); `selectCandidates` queries `coverage_lines` joined to `chunks.metadata.start_line` / `end_line`; coverage hits bypass the candidate cap | Execution-trace evidence shouldn't be capped out by noisier signals. |
| Path normalization | **Caller normalizes paths repo-relative; server stores as-is** | Monorepo path mappings are a tooling concern (CI template's job); Lore doesn't try to be clever about it. |
| Filter | **Drop `node_modules/` / `vendor/` / `dist/` / `build/` rows server-side** | These show up in some coverage reports (tools instrument deps) and have no AST symbols anyway. |
| Webhook fan-out | **`POST /coverage` fires the same `spec-test-linker` trigger that `/api/ingest` does** | A new coverage upload IS new evidence; the linker should re-judge promptly. |
| CI integration | **Per-language workflow snippets added by the `onboard` task** | Same model as ingest; one onboarding PR includes a `lore-coverage.yml` matching the repo's toolchain. |
| Auth | **Existing `write` scope** | Same model as ingest; no new scope. |

## User Experience

### Onboarding a repo for coverage

```
$ lore onboard re-cinq/lore

> Detecting toolchain… package.json + tsconfig.json — Node/TS
> Adding workflows:
    .github/workflows/lore-ingest.yml          (existing)
    .github/workflows/lore-coverage.yml        (NEW)

  Coverage uploads on every push that runs tests.
  Will use vitest --coverage --coverage.reporter=lcov.

  PR: https://github.com/re-cinq/lore/pull/N

  After merge, the next test run uploads coverage; Mon 11:00 UTC
  the linker switches that repo from heuristic-only to
  coverage-aware automatically.
```

For a polyglot monorepo the onboard task adds one workflow per
detected toolchain (Node, Go, Python, Rust…), each scoped to its
subdirectory.

### Daily flow (no UX change for the developer)

The developer's `/lore-link-coverage` skill and the cron + webhook
paths look unchanged. The only visible difference is in the rationale
the judge gives:

```
Before coverage-ingestion:
  runner.test.ts:88 → ordinal 7, score 0.78
    rationale: "mentions claimNextTask in the assertion block"

After coverage-ingestion:
  runner.test.ts:88 → ordinal 7, score 0.94
    rationale: "covers local-runner.ts:42-58 (claimNextTask), which
                this statement names"
```

Scores tighten, false positives drop, the candidate set shrinks from
~25 (capped) to ~5-8 actually-relevant tests.

### Web UI surface

The per-repo specs page gains a small "coverage: live" / "coverage:
absent" pill next to the repo header, showing whether the repo has
uploaded coverage in the last 7 days. Hover reveals the last upload's
commit + timestamp.

## Architecture

```
┌──────────  Repo CI (GitHub Actions, GitLab CI, etc.)  ──────────────┐
│  on push / on PR:                                                    │
│    1. run tests with coverage  →  lcov.info  (or coverage.xml)       │
│    2. upload to Lore:                                                │
│         curl -X POST ${LORE_API_URL}/api/repos/$REPO/coverage \      │
│              -H "Authorization: Bearer ${LORE_INGEST_TOKEN}" \       │
│              -H "Content-Type: application/json" \                   │
│              -d "$(jq -n --arg p "$(cat lcov.info)" \                │
│                          --arg c "$GITHUB_SHA" \                     │
│                          '{format:"lcov", payload:$p, commit:$c}')"  │
└──────────────────────────────────────────────────────────────────────┘
                                  │ HTTPS
                                  ▼
┌──────────────────────  mcp-server (GKE)  ───────────────────────────┐
│  POST /api/repos/:o/:r/coverage   (write scope, bearer auth)         │
│      parseLcov(payload)  OR  parseCobertura(payload)                 │
│         → normalize repo-relative paths                              │
│         → drop node_modules/, vendor/, dist/, build/                 │
│      delete old rows for this commit                                 │
│      bulk upsert into {schema}.coverage_lines                        │
│      delete runs older than 30 days for non-current branches         │
│      fire-and-forget POST /api/trigger/spec-test-linker (re-judge)   │
│      return { rows_written, tests_seen, files_covered }              │
│                                                                      │
│  GET /api/repos/:o/:r/coverage/status  (read scope)                  │
│      → latest commit + run_at + format + counts                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────  Agent linker (cron + webhook + local prepare)  ──────────┐
│  selectCandidates() gets a coverage-aware pre-filter:                │
│                                                                      │
│     for each spec assertion symbol S at file F, lines L1..L2:        │
│       query coverage_lines where                                     │
│         covered_file = F AND lines overlap [L1..L2]                  │
│       → returns the tests that execute S                             │
│       → match_kind = 'coverage', rank 4 (above assertion at 3)       │
│       → bypasses MAX_CANDIDATES_PER_SPEC cap                         │
│                                                                      │
│  Falls back to current signals when coverage_lines is empty for the  │
│  repo (no upload yet, or no coverage for this commit).               │
└──────────────────────────────────────────────────────────────────────┘
```

### Where coverage replaces guesses, and where it doesn't

| Question | Before | After (with coverage) |
|---|---|---|
| Does this test exercise this code? | Guess from name overlap | **Known** (execution trace) |
| Which statement of the spec does the behaviour validate? | LLM judge — guess from text | LLM judge — same task, less noise |
| Did the test pass / fail? | Out of scope | Still out of scope (this feature maps tests to code, not run results — that'd be `coverage-results` follow-up) |

## API

### `POST /api/repos/:owner/:repo/coverage`

Write scope. Bearer auth via the existing routes middleware.

```jsonc
// request
{
  "format": "lcov",                  // or "cobertura"
  "commit": "abc123def…",            // full SHA recommended
  "branch": "main",                  // optional; defaults to default branch
  "payload": "TN:claims pending task\nSF:src/runner.ts\nDA:42,1\n…"
}

// 200
{
  "rows_written": 1842,
  "tests_seen": 312,                 // distinct (test_file, test_name)
  "files_covered": 67,
  "tests_anonymous": 24,             // rows with test_name = '*'
                                     // (per-file aggregate, no TN tag)
  "paths_filtered": 91               // dropped (node_modules etc.)
}

// 400 — bad format / unparsable payload
// 413 — payload too large (cap: 25 MB; bigger uploads should chunk)
```

### `GET /api/repos/:owner/:repo/coverage/status`

Read scope. Surfaces whether coverage is fresh enough to be useful.

```jsonc
{
  "latest_commit": "abc123…",
  "latest_branch": "main",
  "latest_run_at": "2026-06-02T13:47:00Z",
  "stale": false,                    // true if >7 days old
  "format": "lcov",
  "tests_count": 312,
  "files_count": 67,
  "tests_anonymous_pct": 7.7         // % of rows with test_name='*'
}

// 404 — no coverage ever uploaded for this repo
```

## Data Model

One new per-team-schema table, mirroring the `chunks` isolation model.
Created by an ordered migration applied by the existing ui-helm deploy
hook.

### `{schema}.coverage_lines`

```sql
CREATE TABLE IF NOT EXISTS {schema}.coverage_lines (
  id           BIGSERIAL PRIMARY KEY,
  repo         TEXT NOT NULL,            -- owner/name
  commit_sha   TEXT NOT NULL,            -- the upload's commit
  branch       TEXT,                     -- nullable; helpful for retention
  test_file    TEXT NOT NULL,            -- repo-relative; '*' allowed when
                                         -- only a covered_file is known
                                         -- (file-level aggregate uploads)
  test_name    TEXT NOT NULL,            -- normalized; '*' allowed when
                                         -- the format didn't tag per-test
  covered_file TEXT NOT NULL,            -- repo-relative
  line_start   INTEGER NOT NULL,         -- inclusive
  line_end     INTEGER NOT NULL,         -- inclusive
  hit_count    INTEGER,                  -- nullable; LCOV's DA execution count
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, commit_sha, test_file, test_name, covered_file, line_start, line_end)
);

CREATE INDEX coverage_lines_test_idx
  ON {schema}.coverage_lines (repo, test_file, test_name);

CREATE INDEX coverage_lines_file_idx
  ON {schema}.coverage_lines (repo, covered_file, line_start, line_end);

CREATE INDEX coverage_lines_commit_idx
  ON {schema}.coverage_lines (repo, commit_sha, run_at DESC);
```

The two access patterns:
- **Linker** queries by `(repo, covered_file, line range)` to find
  tests that execute a symbol → uses `coverage_lines_file_idx`.
- **Status / freshness** queries by `(repo, commit_sha, run_at)` →
  uses `coverage_lines_commit_idx`.

### `{schema}.coverage_runs`

A small companion table tracking ingest metadata per commit. Lets
`/coverage/status` answer freshness without scanning `coverage_lines`.

```sql
CREATE TABLE IF NOT EXISTS {schema}.coverage_runs (
  repo         TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  branch       TEXT,
  format       TEXT NOT NULL,           -- 'lcov' | 'cobertura'
  tests_count  INTEGER NOT NULL,
  files_count  INTEGER NOT NULL,
  rows_written INTEGER NOT NULL,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, commit_sha)
);
```

### Retention

A daily cron prunes:

```sql
-- prune rows older than 30 days, except the latest per branch
DELETE FROM {schema}.coverage_lines
WHERE run_at < now() - INTERVAL '30 days'
  AND (repo, commit_sha) NOT IN (
    SELECT DISTINCT ON (repo, branch) repo, commit_sha
    FROM {schema}.coverage_runs
    ORDER BY repo, branch, run_at DESC
  );
DELETE FROM {schema}.coverage_runs
WHERE run_at < now() - INTERVAL '30 days'
  AND (repo, commit_sha) NOT IN (...);  -- same predicate
```

## File Changes

| File | Change |
|------|--------|
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_coverage_lines.sql` | NEW: per-schema `coverage_lines` table + 3 indexes |
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_coverage_runs.sql` | NEW: per-schema `coverage_runs` table |
| `mcp-server/src/coverage-ingest.ts` | NEW: LCOV + Cobertura parsers + persistence + path filter + per-commit replacement |
| `mcp-server/src/__tests__/coverage-ingest.test.ts` | NEW: parser tests (LCOV TN handling, end_of_record, DA exec counts; Cobertura element traversal); persistence tests (upsert idempotency, commit replacement, filter drops node_modules) |
| `mcp-server/src/routes.ts` | Modify: register `POST /coverage` and `GET /coverage/status` handlers (write/read scope respectively) |
| `agent/src/jobs/cron/spec-test-linker.ts` | Modify: `selectCandidates()` joins `coverage_lines` against AST symbol ranges; new `match_kind = "coverage"` (rank 4); coverage candidates bypass the cap; falls back to current signals when no coverage rows |
| `agent/src/jobs/cron/spec-test-linker.test.ts` | Modify: cover the coverage-pre-filter path with a fixture; verify rank 4 > rank 3 (assertion) |
| `mcp-server/src/spec-coverage-prepare.ts` (from [`local-coverage-linker`](../local-coverage-linker/spec.md)) | Modify: populate `candidate_tests[*].coverage_hits` from `coverage_lines` joined to chunks (was a `42P01` no-op stub) |
| `agent/src/jobs/cron/coverage-retention.ts` | NEW: daily job that prunes rows >30 days old except the latest per branch |
| `agent/src/job-runner.ts` | Modify: register `coverage_retention` job |
| `terraform/modules/gke-mcp/agent-helm/values.yaml` | Modify: add `coverage-retention` CronJob entry (daily at, say, `0 6 * * *`) |
| `scripts/task-types.yaml` (or wherever `onboard` task lives) | Modify: detect toolchain → emit per-language `.github/workflows/lore-coverage.yml` template |
| `scripts/onboarding-templates/coverage/node.yml` | NEW: Vitest/Jest LCOV upload |
| `scripts/onboarding-templates/coverage/go.yml` | NEW: `go test -coverprofile=cover.out` → `gcov2lcov` → upload |
| `scripts/onboarding-templates/coverage/python.yml` | NEW: `coverage run -m pytest && coverage lcov` → upload |
| `scripts/onboarding-templates/coverage/rust.yml` | NEW: `cargo-tarpaulin --out Lcov` → upload |
| `scripts/onboarding-templates/coverage/java.yml` | NEW: JaCoCo → Cobertura → upload |
| `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` | Modify: render "coverage: live" / "coverage: absent" pill from `/coverage/status` |
| `CLAUDE.md` | Add a short paragraph on coverage ingestion under the linker section |

`NNNN` = next available migration number when this is implemented; will
be `0008`/`0009` if merged after `local-coverage-linker`, otherwise
adjacent.

## Acceptance Criteria

1. Migrations create `coverage_lines` + `coverage_runs` per team schema, idempotently, with the documented indexes; `lore_ui` gets SELECT on both.
2. `POST /api/repos/:o/:r/coverage` parses LCOV (with `TN:` per-test attribution when present, falling back to `test_name='*'` per file) and Cobertura XML, normalizes paths, filters `node_modules/` / `vendor/` / `dist/` / `build/`, upserts into `coverage_lines`, and replaces previous rows for the same `(repo, commit_sha)` on re-upload.
3. `POST /coverage` writes a `coverage_runs` row + fires the existing `spec-test-linker` trigger (fire-and-forget) so the linker re-judges promptly.
4. `GET /api/repos/:o/:r/coverage/status` returns the latest run's metadata, a `stale` flag (>7 days), and `tests_anonymous_pct` so the UI can show how much of the coverage is per-test vs. per-file aggregate. Returns 404 when no coverage exists for the repo.
5. The linker's `selectCandidates()` adds a `coverage` match_kind whose `KIND_RANK` is 4 (above `assertion`=3 / `directory`=2 / `embedding`=1); coverage candidates bypass the `MAX_CANDIDATES_PER_SPEC` cap; when no `coverage_lines` rows exist for the repo the function behaves identically to today.
6. Two tests covering the same `(test_file, test_name)` against the same symbol still collapse to one row via the existing `argmaxByTest` dedup; coverage rank just makes the row stronger.
7. The `local-coverage-linker` `prepare_spec_link` endpoint populates `coverage_hits` on each candidate test from the same join when `coverage_lines` exists; no client change needed.
8. A daily `coverage_retention` job prunes `coverage_lines` + `coverage_runs` older than 30 days, except the most-recent commit per branch (so a stale `main` keeps its last run for resumed work).
9. The `onboard` task emits a per-language `.github/workflows/lore-coverage.yml` matching the repo's detected toolchain (Node, Go, Python, Rust, Java); polyglot repos get one workflow per detected toolchain, each scoped to its subdirectory.
10. Web UI shows a "coverage: live" / "coverage: absent" pill on the per-repo specs page sourced from `/coverage/status`; hover reveals last commit + timestamp.
11. End-to-end: ingest LCOV for one commit; assert the linker's judge calls drop from N to <0.6×N on a representative spec (fewer candidates surveyed; same or higher recall on truly relevant tests).

## Limitations & Open Questions

1. **Per-test attribution is tooling-dependent.** LCOV's `TN:` tag is supported by Vitest/Jest, pytest-cov, etc.; Go's `-coverprofile` is per-file aggregate (no per-test); Rust's tarpaulin tags per-test when available. Aggregate (`test_name='*'`) coverage rows tell the linker "*some* test in this file exercises this code" — less precise but still better than name-overlap guessing. Documented in `/coverage/status.tests_anonymous_pct` so consumers can judge fidelity.
2. **Cross-language matrix.**
   - JS/TS — nyc / Istanbul / Vitest / Jest emit LCOV natively
   - Go — `go test -coverprofile=cover.out` + `gcov2lcov` converter
   - Python — `coverage lcov` (built-in)
   - Rust — `cargo-tarpaulin --out Lcov`
   - Java/Kotlin — JaCoCo → LCOV converter (or Cobertura native)
   - C# / .NET — `coverlet --format lcov`
   - Ruby — `simplecov-lcov` gem
   - PHP — PHPUnit clover → LCOV converter
   - Swift — `xccov-to-lcov`
   - C / C++ — `gcov` + `lcov` tool
   The CI template templates cover the first six; the rest are documented but not auto-generated by `onboard`.
3. **Monorepo path mapping.** Coverage reports use paths relative to the test runner's CWD, which may not match `chunks.file_path`. The CI template's job to normalize; if a repo emits absolute or `src/`-prefixed paths that don't match, the linker silently won't find joins. Mitigation: the upload endpoint accepts an optional `path_prefix_strip` field; documented but not v1.
4. **Storage cost.** A medium repo (~50K LOC, ~500 tests) emits ~30K coverage rows per commit. At 100 commits / week × 30-day retention, that's ~12M rows per repo. Manageable on lore-db (~2 GB per repo at full retention), but bears watching. The retention job is the safety valve; tune the 30-day window if the table grows unwieldy.
5. **No pass/fail status.** Out of scope. This feature maps tests to code; it does not report run results. A follow-up `coverage-results` spec would join the test runner's pass/fail status onto `coverage_lines` and surface red/green per linked test in the UI.
6. **Race with the linker.** The fan-out fires the linker immediately on upload, but the linker's content-hash gate is keyed on the *spec* not on coverage. If a spec hasn't changed but coverage has, the gate skips re-linking — coverage updates without a spec edit won't refresh until the next cron sweep. Mitigation: extend the hash to include coverage's latest `commit_sha` for the repo; documented as a v2 follow-up.
7. **CI is the trust boundary.** A repo with a misconfigured workflow can upload garbage coverage that pollutes the candidate pre-filter. The `coverage_runs.format` + `tests_anonymous_pct` give a smell test; a longer-term answer is signing uploads or rate-limiting per-repo.
8. **Coverage of generated code.** Some build pipelines instrument generated code (proto stubs, codegen). These show up with no AST symbol → no useful join → harmless noise rows. Filterable via a per-repo `coverage_exclude_paths` setting; deferred to v2.
