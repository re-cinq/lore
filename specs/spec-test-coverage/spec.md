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

A **statement-level** spec → test linkage, persisted per-repo, surfaced as a
spec that reads like a coverage heat-map:

1. **A linker job** segments each spec into statements (prose sentences + list
   items), classifies each as **testable** or **untestable** (narrative), then
   for each candidate test asks an LLM judge which single statement it most
   strongly validates (with a score + rationale). It writes statements to
   `spec_statements` and confirmed links to `spec_test_links`.
2. **A redesigned specs page** renders the spec markdown with each statement
   coloured by state — **green** (testable + tested), **red** (testable +
   untested), **grey** (untestable fluff) — hovering a green statement reveals
   the validating test(s) with source links. A stacked three-colour
   **coverage bar** with percentages sits on every card and atop the details
   view. The flat linked-test list is retained below as a secondary index and
   a fallback for links that can't anchor inline.

The structured tables are the point: `spec_statements` + `spec_test_links` are
first-class artifacts other jobs (gap detection, analytics, trust scoring) can
query, not a render-time computation. Because every statement's state is
persisted, "which requirements have no test?" becomes a single query.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Match granularity | **Statement-level** — sentences + list items, not whole-spec | A test validates a specific claim; line-level signal is what reviewers want |
| Test ↔ statement match | **LLM judge picks the single best statement** per candidate test (score + rationale) | Captures intent; one-best-per-test keeps highlights unambiguous |
| Statement state | **Three-way: testable+tested (green) / testable+untested (red) / untestable (grey)** | Distinguishes a real gap from narrative prose so the coverage number isn't polluted |
| Testable vs untestable | **Classifier** (section heuristic + LLM fallback), errs toward `testable` | Intro/vision/clarifications aren't gaps; a false-red is safe, a false-grey hides a gap |
| Coverage signal | **Stacked three-colour bar + percentages** on card and details | One glance shows tested / untested / fluff composition |
| Structured store | **`spec_statements` + `spec_test_links` tables + API endpoint** | Reusable by analytics / gap detection; matches `chunks` isolation model |
| Test source | **Filter existing `content_type = 'code'` chunks** by path heuristics | No ingestion change; tests already present as code chunks |
| Freshness | **Content-hash gate** — re-link a spec only when its content changed | Edited specs re-link promptly; unchanged specs cost zero LLM calls |
| Scope | **Per-repo specs pages only (v1)** | `spec_test_links` is per-team-schema; the global `/specs` viewer is cross-content-type |
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
│ ████████████░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓                             │
│ 75% covered · 6 tested · 2 untested · 4 narrative            │
└────────────────────────────────────────────────────────────┘
```

- **Title** — parsed from the spec's first H1, falling back to the
  feature-directory name, falling back to `file_path`.
- **Summary** — first non-heading paragraph of the spec (≤ ~280 chars),
  not a raw character slice.
- **Coverage bar** — the shared `CoverageBar`: a stacked three-colour bar
  (green tested / red untested / grey narrative) with per-segment
  percentages. Segment widths are over **all** statements; the headline
  "% covered" caption is `tested / (tested + untested)` — fluff excluded, so a
  narrative-heavy spec isn't penalised. Every colour also carries a non-colour
  cue (label / icon) for accessibility. A spec with zero testable statements
  shows a muted, empty bar.

### Details view

A linkable **route** (`/repos/:owner/:repo/specs/[...path]`, matching the
existing per-repo detail route and the global `/specs/[...path]` pattern),
opened by the card's **Details** button. Shows:

1. **The `CoverageBar`** (same component as the card) as the header.
2. **The full spec**, rendered as formatted markdown (`react-markdown` +
   `remark-gfm`, the same stack as `ReadmeBox.tsx`), reassembled from all
   chunks for that `file_path`, with **each statement coloured by state**:
   - **green** — testable and validated by ≥1 test; hovering reveals the
     validating test name(s) + source deep-link(s) and the judge's rationale.
   - **red** — testable but no test links to it (a visible gap).
   - **grey** — untestable narrative (intro / vision / clarification / open
     question / limitation / rationale); hover shows its category.
3. **Matched tests list** (retained), each row: the `describe › it` name, a
   source deep link (`{html_url}/blob/{ref}/{file_path}#L{line}`), and the
   judge's rationale on expand. Links whose statement could not be anchored
   inline (see Limitations) are flagged here so coverage is never silently
   lost.

```
████████████████████░░░░░░░░▓▓▓▓▓▓▓▓▓▓   75% covered · 4 narrative

Full spec ───────────────────────────────────────────────────
# Feature Specification: Local Task Runner

[grey]  A local task runner that runs inside the developer's session …
[green] It claims a pending task before GKE picks it up.   ← hover ↓
          ┌──────────────────────────────────────────────┐
          │ local-runner › claims pending task before GKE │
          │ runner.test.ts:88 ↗                           │
          │ judge: exercises the SKIP LOCKED claim query  │
          └──────────────────────────────────────────────┘
[red]   It re-queues a stale task after 30 minutes.        ← no test

Tests validating this spec (12) ──────────────────────────────
local-runner › claims pending task before GKE      runner.test.ts:88 ↗
local-runner › spawns worktree on explicit run     runner.test.ts:42 ↗  (list-only)
```

## Architecture

```
┌─────────────────── Linker job (post-ingest + weekly sweep) ──────────────────┐
│ for each spec chunk (content_type='spec', isAssertionSource):                 │
│   0. hash reassembleSpec(spec); skip if unchanged (spec_coverage_runs)        │
│   1. segmentStatements(spec)            → sentences + list items (deterministic)│
│   2. classify each statement            → testable | untestable (+ category)  │
│        section heuristic first, LLM fallback for ambiguous prose              │
│   3. upsert statements → {schema}.spec_statements; prune dropped ordinals     │
│   4. extractAssertions(spec)            ← reuse spec-drift LLM extraction      │
│   5. candidate tests =                                                         │
│        code chunks where file_path matches a TEST_PATH pattern                 │
│        AND (references an assertion symbol  OR  embedding sim ≥ τ              │
│             OR shares the spec's feature directory)                            │
│   6. for each candidate: judge(testable statements, test)                     │
│        → { matches, statement_ordinal, score, rationale }                     │
│   7. keep max-score statement per test (best-match-per-test, ≥ τ_score)       │
│   8. upsert confirmed links → {schema}.spec_test_links                         │
│   9. delete stale links no longer confirmed this run; record content_hash     │
└───────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────── Web UI (per-repo only) ──────────────────────────────┐
│ GET /api/repos/:owner/:repo/spec-coverage                                     │
│   → [{ spec_path, title, summary,                                             │
│        coverage:{ testable, covered, untestable },                            │
│        statements:[{ ordinal, text, kind, testability, category }],           │
│        tests:[{ name, file_path, line, statement_ordinal, match_score,        │
│                 symbol, rationale, url }] }]                                   │
│ page.tsx (server)  → SpecCard + CoverageBar from coverage payload            │
│ SpecDetails.tsx (client) → rehype-highlighted markdown + CoverageBar + list  │
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
goes to the LLM judge. The judge is given the spec's **enumerated testable
statements** and the test, and returns
`{ matches, statement_ordinal, score, rationale }` — *which single statement*
the test most strongly validates, not just a yes/no. Only `matches = true`
rows with `score ≥ τ_score` (default 0.5) are persisted; the rationale and
score are stored and shown in the details view.

If the candidate cap is hit, the job **logs the truncation** (per the "no
silent caps" rule) so coverage is never silently under-reported.

**Best-match-per-test.** A test that scores against several statements is
reduced to its single highest-scoring statement before persistence
(`argmax(score)` per `(test_file, test_name)`). The existing
`UNIQUE (repo, spec_path, test_file, test_name)` already permits one row per
test per spec, so this needs no constraint change — only the dedup. A single
statement may still be the best match for several tests (all listed on hover).

### Statement segmentation and classification

`segmentStatements(content)` (a deterministic pure function, shared by the
linker and the renderer so ordinals agree) splits the reassembled spec into
**statements**: prose paragraphs are split into sentences (`.?!` with an
abbreviation guard), and each list item is its own statement. Headings, fenced
code, and tables are excluded. It tracks each statement's enclosing heading.

Each statement is then classified `testable` | `untestable`:

1. **Section heuristic (cheap, high precision)** — statements under
   `Problem Statement`, `Vision`, `Background`, `Clarifications`,
   `Open Questions`, `Limitations`, `Rationale`, plus the H1/intro paragraph →
   `untestable`, tagged with the matching `category`.
2. **LLM fallback** — statements the heuristic doesn't catch get a batched
   one-shot classification ("normative testable requirement, or narrative?").
3. Acceptance Criteria / numbered requirement list items default to `testable`.

The classifier **errs toward `testable`** when unsure: a false-red is a
visible (harmless) gap, while a false-grey would hide a real gap.

### API

`GET /api/repos/:owner/:repo/spec-coverage` (read scope) — returns the
coverage payload the page renders: per spec, the `coverage` counts, the full
`statements` array (with `testability`/`category`), and the matched `tests`
(each with `statement_ordinal` + `match_score` + source URL). Read-only; the
page never computes matches or classification at render time. Bearer-auth via
the existing `routes.ts` middleware. Full payload shape in
[data-model.md](./data-model.md).

### UI changes

- `page.tsx` — thin server component that fetches the coverage payload (or
  queries `spec_statements` + `spec_test_links` + `chunks` directly via
  `db.ts`) and maps rows to `<SpecCard>`.
- `SpecCard` — title, summary, `<CoverageBar>`, Details button.
- `CoverageBar` (new, shared) — stacked three-segment bar
  (`{ tested, untested, fluff }`) + percentages, used on the card and the
  details header. Colours from theme tokens (`--success` / `--danger` /
  `--text-muted`), each with a non-colour cue. Lives in `web-ui/src/components/`.
- `SpecDetails` (client) — `react-markdown` render with a **rehype highlight
  plugin** that wraps each matched statement's longest contiguous text run in
  a `<mark>` carrying its state class, mapped to a hover-popover component;
  plus the `CoverageBar` header and the retained test list. Reuses the
  markdown stack and the `HelpPopover` hover pattern.
- The existing "Add Spec" form is preserved unchanged.

## Data Model

Three per-team-schema tables (mirroring `chunks` isolation): `spec_statements`
(every classified statement), `spec_test_links` (one row per confirmed
statement↔test link), `spec_coverage_runs` (content-hash freshness gate). The
`spec_test_links` table is **extended** additively with `statement_ordinal`,
`statement_text`, `match_score`. Full DDL, column notes, and the API payload
shape in [data-model.md](./data-model.md).

## File Changes

| File | Change |
|------|--------|
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_spec_test_links.sql` | Existing: per-schema `spec_test_links` table + indexes |
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_spec_statements.sql` | New: `spec_statements` + `spec_coverage_runs` tables; additive `ALTER TABLE spec_test_links ADD COLUMN IF NOT EXISTS` (statement_ordinal, statement_text, match_score) + index |
| `agent/src/lib/spec-segment.ts` | New: `segmentStatements()` (pure, deterministic, shared with web-ui) + statement classifier helpers |
| `agent/src/jobs/spec-test-linker.ts` | Modify: content-hash gate, segment + classify statements, statement-level judge, best-match-per-test dedup, persist statements + scored links |
| `agent/src/jobs/spec-test-linker.test.ts` | Modify: add tests for segmentation, section-heuristic classification, best-match dedup, ordinal stability |
| `agent/src/lib/test-paths.ts` | Existing: `isTestFile()` + `normalizeTestName()` (pure, shared) |
| `agent/src/index.ts` | Modify: post-ingest trigger for the linker in addition to the weekly schedule |
| `mcp-server/src/routes.ts` | Modify: `spec-coverage` handler returns statements + coverage counts + per-test ordinal/score |
| `web-ui/src/lib/spec-summary.ts` | Modify: add `segmentStatements()` (or import the shared impl) alongside `parseSpecTitle()` / `extractSummary()` |
| `web-ui/src/components/CoverageBar.tsx` | New: shared stacked three-colour coverage bar + percentages |
| `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` | Modify: coverage-driven cards with `<CoverageBar>`; keep Add Spec form |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` | Modify: replace the inline test-count line with `<CoverageBar>` + caption |
| `web-ui/src/app/repos/[owner]/[repo]/specs/[...path]/page.tsx` | Modify: pass statements to the renderer for highlighting |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` | Modify: rehype statement-highlight plugin + hover popovers + `CoverageBar` header; retain the test list |

## Acceptance Criteria

1. `spec_statements`, `spec_test_links`, and `spec_coverage_runs` exist per team schema with the documented columns; the additive `spec_test_links` statement columns apply idempotently to existing tables.
2. The linker segments a spec into statements (sentences + list items) and classifies each as `testable` or `untestable` with a category; the segmentation is deterministic so the renderer reproduces identical ordinals.
3. The linker skips any spec whose content hash is unchanged since its last run (freshness gate), and re-links promptly on a spec edit/re-ingest.
4. The LLM judge persists only confirmed links with `match_score ≥ τ`, each carrying the validated `statement_ordinal`, score, and a non-empty rationale; candidate truncation is logged.
5. A test that matches multiple statements highlights only its single best (`argmax score`) statement; a statement may be the best match for several tests.
6. Re-running the linker prunes links and statements no longer present (no stale rows accumulate).
7. `GET /api/repos/:owner/:repo/spec-coverage` returns, behind bearer auth, per-spec title, summary, coverage counts, the full statements array, and the matched test list with source URLs.
8. Every card and the details header render a stacked three-colour `CoverageBar` (green tested / red untested / grey narrative) with percentages; segment widths sum to 100% of all statements and the "% covered" caption is tested/testable.
9. The details view renders the full spec as formatted markdown with each statement coloured by state: green (tested, hover reveals validating test(s) + source links + rationale), red (testable, untested), grey (untestable, hover shows category).
10. Untestable statements (intro / vision / clarification / open-question / limitation / rationale) are visibly de-emphasised and excluded from the coverage denominator.
11. Every coverage colour carries a non-colour cue (label/icon) for accessibility.
12. Links whose statement could not be anchored inline still appear in the retained full test list (no silent coverage loss); pre-existing whole-spec link rows degrade gracefully (no highlights) until the spec is re-linked.
13. The existing "Add Spec" form continues to work unchanged.

## Limitations & Open Questions

1. **Inline anchoring of formatted statements** — `react-markdown` splits a
   statement that crosses inline formatting (bold, inline code, links) into
   multiple text nodes, so the rehype plugin can't always wrap it as one
   contiguous green run. Plain-prose sentences and plain list items highlight
   cleanly; a formatting-mixed statement may not colour inline in v1. The
   always-present full test list is the fallback so no link is silently lost
   (the "no silent caps" rule), and each link records whether it anchored.
2. **Classifier precision** — testable/untestable is a fuzzy judgment. The
   section heuristic is high-precision; the LLM fallback is not perfect and
   is biased toward `testable` so a misclassification surfaces a harmless red
   rather than hiding a gap behind grey. A manual override is a possible
   follow-up.
3. **No pass/fail status** — this feature maps tests to statements; it does
   not report whether those tests pass. Run status is explicitly out of scope
   (could be a follow-up that joins CI results onto `spec_test_links`).
4. **Details view: route, resolved** — uses the route
   `/repos/:o/:r/specs/[...path]` (already built that way), for shareable
   links and SSR markdown rather than a modal.
5. **Judge cost** — bounded by the candidate cap and now further bounded by
   the content-hash freshness gate (unchanged specs are skipped entirely).
   Segmentation + classification add a small per-changed-spec LLM cost.
6. **Test line numbers** — depend on AST chunk metadata capturing the
   `it()` line (`chunks.metadata.start_line`). Where absent, the source link
   points at the file, not the line.
7. **Global `/specs` viewer** — out of scope for v1; highlighting and the
   coverage bar live only on the per-repo specs pages because
   `spec_test_links` is per-team-schema and the global viewer is
   cross-content-type.
8. **Auto-file a gap-fill task** for `testable` + uncovered (red) statements,
   like spec-drift does for code divergence? Out of scope; `spec_statements`
   makes it a trivial per-statement follow-up.
