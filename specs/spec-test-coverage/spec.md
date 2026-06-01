# Feature Specification: Spec → Test Coverage

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Spec → Test Coverage                     |
| Status         | Draft                                    |
| Created        | 2026-06-01                               |
| Owner          | Platform Engineering                     |

## Problem Statement

The per-repo specs page (`/repos/[owner]/[repo]/specs`) is a flat list
of cards whose title is the raw `file_path` and whose body is a
400-character `<pre>` dump of the chunk content. It answers "what specs
exist" and nothing else.

It does not answer the question that actually matters for project
health: **is this spec backed by tests, and where are they?**

Lore already detects spec → *code* drift (`agent/src/jobs/spec-drift.ts`
extracts named assertions from a spec via LLM and matches them against
`content_type = 'code'` symbol metadata). The mirror image — spec → *test*
coverage — does not exist. There is no persisted, queryable record of
which tests validate which spec, so neither the UI nor any analysis job
can reason about coverage.

## Solution

A structured spec → test linkage, persisted per-repo, surfaced as a
redesigned specs page:

1. **A linker job** discovers candidate tests for each spec, asks an LLM
   judge whether each candidate actually validates the spec (with a
   rationale), and writes confirmed links to a new `spec_test_links`
   table.
2. **A redesigned specs page** renders one card per spec — parsed title,
   short summary, and a coverage line ("7 tests linked") — with a
   **Details** button opening the full spec rendered as markdown plus the
   matched test list, each test linking to its source with its name.

The structured table is the point: it is a first-class artifact other
jobs (gap detection, analytics, trust scoring) can query, not a render-time
computation.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test ↔ spec match | **LLM relevance judge** (per candidate pair, with rationale) | Captures intent, not just naming; pre-filtered so cost stays bounded |
| Structured store | **New `spec_test_links` table + API endpoint** | Reusable by analytics / gap detection; matches `chunks` isolation model |
| Test source | **Filter existing `content_type = 'code'` chunks** by path heuristics | No ingestion change; tests already present as code chunks |
| Test pass/fail status | **Not shown** | Out of scope — this feature maps tests to specs, it does not report run results |

## User Experience

### Card list (redesigned)

```
┌────────────────────────────────────────────────────────────┐
│ Local Task Runner                                  [Details] │
│ specs/local-task-runner/spec.md                              │
│                                                              │
│ A local task runner that runs inside the developer's Claude  │
│ Code session, spawning background work in isolated git       │
│ worktrees using their subscription instead of API credits.   │
│                                                              │
│ ● 12 tests linked                                            │
└────────────────────────────────────────────────────────────┘
```

- **Title** — parsed from the spec's first H1, falling back to the
  feature-directory name, falling back to `file_path`.
- **Summary** — first non-heading paragraph of the spec (≤ ~280 chars),
  not a raw character slice.
- **Coverage line** — count of linked tests. Specs with zero linked tests
  show `○ no tests linked` (a coverage gap signal).

### Details view

Triggered by the **Details** button on a card (route or modal — see Open
Questions). Shows:

1. **Full spec**, rendered as formatted markdown (`react-markdown` +
   `remark-gfm`, the same stack as `ReadmeBox.tsx`), reassembled from all
   chunks for that `file_path`.
2. **Matched tests list**, each row:
   - **Test name** — the `describe > it` path, e.g.
     `shouldSkipDrift › suppresses within cooldown`
   - **Source link** — deep link to the test on the repo's host
     (`{html_url}/blob/{ref}/{file_path}#L{line}`)
   - On expand: the LLM judge's one-line rationale for why this test was
     linked to the spec

```
Full spec ───────────────────────────────────────────────────
# Feature Specification: Local Task Runner
... (rendered markdown) ...

Tests validating this spec (12) ──────────────────────────────
local-runner › claims pending task before GKE      runner.test.ts:88 ↗
local-runner › spawns worktree on explicit run      runner.test.ts:42 ↗
local-runner › re-queues stale task after 30 min    runner.test.ts:140 ↗
  └ judge: asserts stale-task cleanup re-queues to GKE (AC #12)
```

## Architecture

```
┌─────────────────────── Linker job (weekly + on-demand) ──────────────────────┐
│ for each spec chunk (content_type='spec', isAssertionSource):                 │
│   1. extractAssertions(spec)            ← reuse spec-drift LLM extraction      │
│   2. candidate tests =                                                         │
│        code chunks where file_path matches a TEST_PATH pattern                 │
│        AND (references an assertion symbol  OR  embedding sim ≥ τ              │
│             OR shares the spec's feature directory)                            │
│   3. for each candidate: LLM judge(spec, test) → { matches, rationale }        │
│   4. upsert confirmed links → {schema}.spec_test_links                         │
│   5. delete stale links no longer confirmed this run                           │
└───────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────── Web UI ──────────────────────────────────────────────┐
│ GET /api/repos/:owner/:repo/spec-coverage                                     │
│   → [{ spec_path, title, summary, test_count,                                 │
│        tests:[{ name, file_path, line, symbol, rationale, url }] }]            │
│ page.tsx (server)  → cards from coverage payload                              │
│ SpecDetails.tsx (client) → markdown spec + test list                          │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Matching algorithm (cost-bounded LLM judge)

A naive judge is `N_specs × N_tests` LLM calls. We bound it with a
**candidate pre-filter** before the judge ever runs:

1. **Assertion overlap** — reuse `extractAssertions()` from spec-drift to
   get the spec's named symbols; a test file is a candidate if its chunk
   content references any of those symbol names. (Strongest signal — the
   test literally exercises a symbol the spec names.)
2. **Directory affinity** — a test under the same feature path as the
   spec (e.g. spec `specs/local-task-runner/` ↔ test `local-runner.test.ts`)
   is a candidate.
3. **Embedding proximity** — test chunks whose embedding cosine-similarity
   to the spec exceeds τ (default 0.75) are candidates. (Optional/best-effort;
   only for tests that have embeddings.)

The union of candidates (capped at `MAX_CANDIDATES_PER_SPEC`, default 25)
goes to the LLM judge, which returns `{ matches: boolean, rationale: string }`
per pair. Only `matches = true` rows are persisted. The rationale is stored
and shown in the details view.

If the candidate cap is hit, the job **logs the truncation** (per the "no
silent caps" rule) so coverage is never silently under-reported.

### API

`GET /api/repos/:owner/:repo/spec-coverage` (read scope) — returns the
coverage payload the page renders. Read-only; the page never computes
matches at render time. Bearer-auth via the existing `routes.ts`
middleware.

### UI changes

- `page.tsx` becomes a thin server component that fetches the coverage
  payload (or queries `spec_test_links` + `chunks` directly via `db.ts`)
  and maps rows to `<SpecCard>`.
- `SpecCard` — title, summary, coverage line, Details button.
- `SpecDetails` (client) — `react-markdown` spec render + test list with
  source links. Reuses the markdown approach from `ReadmeBox.tsx`.
- The existing "Add Spec" form is preserved unchanged.

## Data Model

New per-team-schema table `spec_test_links` (one per team schema, mirroring
`chunks` isolation). Full DDL in [data-model.md](./data-model.md).

```sql
CREATE TABLE {schema}.spec_test_links (
  id           BIGSERIAL PRIMARY KEY,
  repo         TEXT NOT NULL,
  spec_path    TEXT NOT NULL,         -- chunks.file_path of the spec
  test_file    TEXT NOT NULL,         -- chunks.file_path of the test
  test_name    TEXT NOT NULL,         -- normalized "describe > it"
  test_line    INTEGER,               -- best-effort line for source deep-link
  symbol       TEXT,                  -- linking assertion symbol, if any
  match_kind   TEXT NOT NULL,         -- 'assertion' | 'directory' | 'embedding'
  rationale    TEXT NOT NULL,         -- LLM judge's reason
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, spec_path, test_file, test_name)
);
```

## File Changes

| File | Change |
|------|--------|
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_spec_test_links.sql` | New: per-schema `spec_test_links` table + indexes |
| `agent/src/jobs/spec-test-linker.ts` | New: candidate pre-filter + LLM judge + upsert |
| `agent/src/jobs/spec-test-linker.test.ts` | New: pure-function unit tests (candidate selection, name normalization, stale-link pruning) |
| `agent/src/lib/test-paths.ts` | New: `isTestFile()` path heuristics + `normalizeTestName()` (pure, shared) |
| `agent/src/index.ts` | Register the linker job on its schedule |
| `mcp-server/src/routes.ts` | New `GET /api/repos/:owner/:repo/spec-coverage` handler |
| `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` | Rewrite: coverage-driven cards; keep Add Spec form |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` | New: card (title, summary, coverage line, Details) |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` | New (client): markdown spec + matched test list with source links |
| `web-ui/src/lib/spec-summary.ts` | New: `parseSpecTitle()` + `extractSummary()` (pure) |

## Acceptance Criteria

1. `spec_test_links` table exists per team schema with the documented columns and unique constraint.
2. The linker job extracts assertions, selects candidate tests via path heuristics + assertion overlap + directory affinity, and never exceeds `MAX_CANDIDATES_PER_SPEC` without logging the truncation.
3. The LLM judge persists only confirmed (`matches = true`) links, each with a non-empty rationale.
4. Re-running the linker prunes links no longer confirmed (no stale rows accumulate).
5. `GET /api/repos/:owner/:repo/spec-coverage` returns per-spec title, summary, test count, and the matched test list with source URLs, behind bearer auth.
6. The specs page renders one card per spec with parsed title, paragraph summary, and a coverage line (linked-test count), not a raw `<pre>` dump.
7. A spec with zero linked tests renders a visible "no tests linked" gap state.
8. The Details button opens the full spec rendered as formatted markdown (reassembled across all chunks for the path) plus the matched test list.
9. Each test row shows a working source-code deep link and the `describe > it` name; the judge rationale is viewable.
10. The existing "Add Spec" form continues to work unchanged.

## Limitations & Open Questions

1. **No pass/fail status** — this feature maps tests to specs; it does not
   report whether those tests pass. Run status is explicitly out of scope
   (could be a follow-up that joins CI results onto `spec_test_links`).
2. **Details view: route vs modal** — a modal keeps context but a route
   (`/repos/:o/:r/specs/[...path]`) is linkable and matches the existing
   global `/specs/[...path]` detail page. **Recommendation: route**, for
   shareable links and SSR markdown. To confirm at plan time.
3. **Judge cost** — bounded by the candidate cap, but a repo with many
   specs × many tests is still the dominant LLM cost. The weekly cadence
   + activity pre-filter (mirroring spec-drift) keeps it in check.
4. **Test line numbers** — depend on AST chunk metadata capturing the
   `it()` line. Where absent, the source link points at the file, not the
   line.
5. **Should low-coverage specs auto-file a gap-fill task** (like
   spec-drift does for code divergence)? Out of scope here; the table
   makes it a trivial follow-up.
