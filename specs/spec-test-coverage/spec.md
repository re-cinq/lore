# Feature Specification: Spec → Test Coverage (v3)

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Spec → Test Coverage                     |
| Status         | Draft (v3) — supersedes v1 and v2        |
| Created        | 2026-06-01                               |
| Last redesign  | 2026-06-02 (v3, author-driven markdown links + cron-as-suggester) |
| Owner          | Platform Engineering                     |
| Supersedes     | `local-coverage-linker` (BYO-compute persist path); defers `coverage-ingestion` (decoupled from v3) |

## Problem Statement

The per-repo specs page renders specifications as a flat list of cards.
v1 added a test-count line. v2 added a statement-level coverage bar
driven by a server-side LLM linker that wrote `spec_statements`,
`spec_test_links`, and `spec_coverage_runs` per repo.

After shipping v2, three weaknesses became obvious:

1. **The linker infers what the author already knows.** A spec author
   knows which tests validate which behaviour better than any LLM
   judge can guess from prose + test names + heuristic candidate
   selection.
2. **The persistence apparatus is overhead in service of
   inference.** Three tables, a cron job, a post-ingest webhook
   fan-out, a BYO-compute MCP path (`prepare`/`persist`/`stale`),
   and a `/lore-link-coverage` skill all exist to render colored
   marks on statements that could be marked once, in markdown, in
   the spec.
3. **Hallucination risk and drift.** Even with τ=0.5 + argmax-by-
   test, the v2 judge occasionally picks the wrong statement. A
   markdown link in the spec cannot hallucinate — it either resolves
   to a real test or it doesn't. And the link travels with the spec
   in git: the PR that adds the spec edit adds the test link too,
   so reviewers see both at once instead of the cron silently
   updating the DB hours later.

v3 inverts: **author-written markdown links in `spec.md` are the
source of truth.** The UI parses and colors them at render time. The
cron survives, but its role shrinks from "write inferred links to
the DB" to two clean responsibilities:

- **Validate**: parse links in each spec, resolve them against the
  AST-chunked test metadata in `{schema}.chunks`, and open a PR
  comment (or issue) when a link rots (test deleted, renamed, or
  line range moved).
- **Backfill**: for testable statements with no link, run the v2
  judge pipeline (segment → classify → candidate selection →
  statement-level judge) and open a PR that **edits `spec.md` to add
  the suggested links**. The author reviews and merges (or rejects)
  the suggestion. The judge's output is markdown, not a DB row.

No `spec_statements`, no `spec_test_links`, no `spec_coverage_runs`
in the v3 happy path. The v2 tables, migrations, MCP tools, persist
API, and `/lore-link-coverage` skill are scheduled for deletion in
the v3 cleanup phase.

## Solution

A **statement-level** spec → test linkage where the source of truth
is markdown in `spec.md`:

```markdown
## Acceptance Criteria

1. The runner claims a pending task before GKE picks it up.
   ([validated by `runner.test.ts:88`](apps/mcp-server/src/local-runner.test.ts#L88))
2. Tasks survive rollout restarts via the lease backend.
   ([validated by `lease-backend.test.ts:42`](apps/agent/src/supervisor/lease.test.ts#L42),
   [`lease-backend.test.ts:74`](apps/agent/src/supervisor/lease.test.ts#L74))
3. The runner re-queues a stale task after 30 minutes.
   <!-- no link yet — cron's backfill pass will suggest one -->
```

**Format**: each statement carries an inline parenthetical at end of
sentence / list item. The parenthetical contains one or more
`[label](path#Lline)` markdown links pointing at the test file +
line. Multiple links separated by commas. Statements with no link
render as visible red gaps in the UI.

### What the UI does

The same `SpecDetails` rehype plugin that v2 used for statement
highlighting now keys off the markdown link's `href`:

- **Any `<a>` whose href passes `isTestFile()`** (shared helper, same
  one the v2 linker used) → wrap the link in `class="stmt-tested"`,
  AND wrap its enclosing statement in `class="stmt"` with state
  `tested`.
- **Statements with no test link** under a heading the section
  heuristic marks **testable** → wrap in `class="stmt-untested"`
  (red), counted as a visible gap.
- **Statements under a narrative section** (Problem Statement /
  Vision / Background / Clarifications / Open Questions / Limitations
  / Rationale, plus the H1 intro) → wrap in `class="stmt-narrative"`
  (grey), excluded from the coverage denominator. Reuses
  `classifyByHeuristic()` from v2 unchanged.
- **Any other `<a>`** (a regular link to an ADR, a Slack thread, an
  external docs page) → renders unchanged, no special class.

The `CoverageBar` math is now over **link presence**:

- `covered` = statements with ≥1 test link
- `untested` = testable statements with zero test links
- `narrative` = untestable statements (per the section heuristic)
- `tested / (tested + untested)` is the headline percentage; same as v2.

### What the cron does

Two passes, both repurposed from the v2 `agent/src/jobs/cron/spec-test-linker.ts`:

```
┌─── Validate pass (runs on every ingest, fire-and-forget) ─────────┐
│  for each spec chunk in the just-ingested repo:                    │
│    reassembleSpec → segmentStatements → parse markdown links per   │
│    statement → for each link:                                      │
│      - resolve `path#Lline` against {schema}.chunks                │
│        (content_type='code', metadata.start_line, metadata.end_line)│
│      - if no chunk matches OR the chunk no longer contains a test  │
│        symbol on that line → flag as `link_rot`                    │
│    if any flags: open a PR comment (or issue) with the broken-link │
│    list. No DB writes. No spec edits.                              │
└────────────────────────────────────────────────────────────────────┘

┌─── Backfill pass (weekly, Mon 11:00 UTC, manual trigger optional) ┐
│  for each spec chunk:                                              │
│    reassembleSpec → segmentStatements →                            │
│    classifyByHeuristic + LLM-fallback → for each TESTABLE          │
│    statement WITHOUT a test link:                                  │
│      run the v2 judge pipeline (candidate selection + judge) to    │
│      produce a suggested link.                                     │
│    if any suggestions: open a PR titled                            │
│      "Suggested test links for specs/X/spec.md"                    │
│    body = inline diff that adds the suggested                      │
│      `([validated by ...](path#Lline))` parentheticals.            │
│    Author reviews + merges (or rejects).                           │
└────────────────────────────────────────────────────────────────────┘
```

The backfill PR is the **only** mechanism by which the cron writes
anything. No DB rows. No silent state. Every cron action is
reviewable as a git PR.

### Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth | **Markdown links in `spec.md`** | Git-tracked, author-reviewed, no hallucination, PR-co-located |
| Link format | **Inline parenthetical at end of statement**: `Statement text. ([label](path#Lline))` | Lowest visual noise; works for prose + lists; rehype detects deterministically; multiple links comma-separated inside one paren |
| Test-file detection | Reuse `isTestFile()` from `@re-cinq/lore-shared` on the `<a>` href's path component | Same heuristic the v2 linker used; one shared source of truth |
| Statement segmentation | Reuse `segmentStatements()` + `classifyByHeuristic()` from `@re-cinq/lore-shared` | The ordinal contract still applies — UI + cron must agree on what counts as a statement |
| Server-side state | **None.** The v2 tables (`spec_statements`, `spec_test_links`, `spec_coverage_runs`) are scheduled for deletion | Spec authors update the file; UI reads it; cron proposes via PR |
| Cron — validate | **Runs on every ingest** (replaces the v2 fan-out webhook trigger). Pure resolution against `chunks`; no LLM. Outputs broken-link reports as PR comments. | Cheap; catches link rot promptly |
| Cron — backfill | **Weekly schedule + manual trigger**. Runs the v2 judge pipeline but emits its output as **PR edits to `spec.md`**, not DB rows | Expensive; weekly is right cadence |
| Backfill output target | **PR against the spec's own repo** adding the suggested markdown links inline | Author reviews in their normal git flow; no UI for "accept/reject suggestions" needed |
| Validation output target | **PR comment** on the most recent open PR touching the spec, or an issue if none exists | Surfaces link rot at the right moment |
| Coverage scope | Per-repo specs pages only (v2 limitation carries over) | The global `/specs` viewer doesn't get statement-level coloring |
| Pass/fail status | **Not shown** (v2 limitation carries over) | Out of scope; this feature maps tests to statements, not run results |
| v2 cleanup | A separate **Phase 4** drops the v2 tables, MCP tools, persist API, BYO-compute skill, and `local-coverage-linker` apparatus | Avoids "ghost state" once v3 ships |

## User Experience

### Author flow

```
Author edits specs/local-task-runner/spec.md, adding a new
acceptance criterion:

  3. The runner re-queues a stale task after 30 minutes.

Author commits, opens PR.

  Within minutes, the cron's validate pass runs on the new ingest:
  - parses all the links in the spec
  - no broken links found
  - (silent — only comments on rot)

  Mondays at 11:00 UTC, the cron's backfill pass runs:
  - finds the new statement has no test link
  - segment + classify → testable, no link → eligible
  - judge pipeline finds a candidate test
  - opens a PR:

    "Suggested test links for specs/local-task-runner/spec.md"

    --- a/specs/local-task-runner/spec.md
    +++ b/specs/local-task-runner/spec.md
    @@ -56,7 +56,8 @@
       2. Tasks survive rollout restarts via the lease backend.
          ([validated by lease-backend.test.ts:42](...))
    -  3. The runner re-queues a stale task after 30 minutes.
    +  3. The runner re-queues a stale task after 30 minutes.
    +     ([validated by runner.test.ts:142](apps/mcp-server/src/local-runner.test.ts#L142))

  Author reviews, merges (or rejects with a comment explaining why
  the suggestion misses).
```

### UI flow

The per-repo specs page (`/repos/:o/:r/specs`) renders the same
`SpecCard` and `SpecDetails` as v2. Coverage math comes from
parsing the spec markdown, not from a DB query.

- `SpecCard` shows: title, summary, `CoverageBar` (over link
  presence), Details button.
- `SpecDetails` renders the full markdown with statement coloring:
  green statements have an inline `[validated by ...](...)` link;
  hovering reveals the linked test name and source URL (the
  popover content comes from the link itself — no rationale,
  because nothing was inferred).
- Red statements are visible gaps. No popover, just colour.
- Grey statements (narrative) hover reveals the section category
  (intro / vision / limitation / etc.).

### Cron diagnostics

Every cron run records a log line per spec:
```
[job] spec-test-coverage: re-cinq/lore:specs/local-task-runner/spec.md
  — 24 statements, 16 testable, 11 linked, 5 untested (suggestions in PR #492)
```

Failed runs surface in the existing `pipeline.job_runs` table.

## Architecture

```
┌──────  Author edits spec.md (with or without test links)  ─────────┐
│  git push  →  GitHub Actions ingest  →  POST /api/ingest           │
└────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────  mcp-server /api/ingest  ───────────────────────────────────┐
│  upsert chunks                                                     │
│  fire-and-forget: POST /api/trigger/spec-coverage-validate          │
│    (replaces the v2 spec-test-linker trigger)                      │
└────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────  agent /api/trigger/spec-coverage-validate  ────────────────┐
│  scope: that one repo                                              │
│  for each spec chunk:                                              │
│    reassemble → segment → for each statement's links:              │
│      resolve href #Lline against {schema}.chunks AST metadata      │
│  if broken links found → open PR comment on latest open PR for the │
│    spec's repo, OR open an issue                                   │
└────────────────────────────────────────────────────────────────────┘

┌──────  agent weekly CronJob spec-coverage-backfill  ──────────────┐
│  for each repo, for each spec:                                     │
│    reassemble → segment → classify (heuristic + LLM fallback) →    │
│    for each TESTABLE statement WITH NO link:                       │
│      selectCandidates → judgeLink → propose markdown link          │
│    aggregate suggestions per spec → open one PR per spec with the  │
│    suggested inline-link insertions                                │
└────────────────────────────────────────────────────────────────────┘

┌──────  Web UI per-repo specs page  ───────────────────────────────┐
│  reads spec chunks ONLY (no spec_statements / spec_test_links /    │
│  spec_coverage_runs queries)                                       │
│  reassemble → segment → classifyByHeuristic →                      │
│  rehype plugin: detect <a href> matching isTestFile,               │
│    wrap statement state class                                      │
│  CoverageBar: count statements with ≥1 test link as "covered"      │
└────────────────────────────────────────────────────────────────────┘
```

## Data Model

**No new tables in v3.** The v2 tables become unused; a cleanup
migration drops them in Phase 4:

```sql
-- terraform/modules/gke-mcp/ui-helm/migrations/NNNN_drop_v2_spec_coverage_tables.sql
DO $$ DECLARE s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname IN ('spec_test_links','spec_statements','spec_coverage_runs')
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.spec_test_links CASCADE', s);
    EXECUTE format('DROP TABLE IF EXISTS %I.spec_statements CASCADE', s);
    EXECUTE format('DROP TABLE IF EXISTS %I.spec_coverage_runs CASCADE', s);
  END LOOP;
END$$;
```

The validate pass needs no new tables either — it joins existing
`{schema}.chunks` rows on `(file_path, metadata.start_line,
metadata.end_line)` to resolve `path#Lline` link targets.

## API

### Endpoints removed (v2 → v3 cleanup, Phase 4)

- `GET  /api/repos/:o/:r/spec-coverage`           → removed
- `GET  /api/repos/:o/:r/spec-coverage/stale`     → removed
- `POST /api/repos/:o/:r/spec-coverage/prepare`   → removed
- `POST /api/repos/:o/:r/spec-coverage/persist`   → removed
- `POST /api/trigger/spec-test-linker`            → removed (replaced
  by `/api/trigger/spec-coverage-validate`)

### Endpoint kept (renamed)

`POST /api/trigger/spec-coverage-validate` — agent-side endpoint.
Replaces `/api/trigger/spec-test-linker`. Body `{ repo }`. Returns
202. Runs the validate pass in the background.

No new HTTP API surface for the backfill — it runs from the
CronJob via `node dist/job-runner.js spec_coverage_backfill`.

### MCP tools removed

- `prepare_spec_link`            → removed
- `persist_spec_link`            → removed
- `list_stale_spec_coverage`     → removed
- `/lore-link-coverage` skill    → removed

## File Changes

| File | Change |
|------|--------|
| `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` | Modify: drop `spec_statements` / `spec_test_links` / `spec_coverage_runs` queries; read chunks only; pass chunks to SpecCard which derives coverage from markdown link parsing |
| `web-ui/src/app/repos/[owner]/[repo]/specs/[...path]/page.tsx` | Modify: same — chunks only; pass to SpecDetails |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` + `SpecCardData` | Modify: accept content (or pre-derived counts); render `CoverageBar` from link-count math |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` | Modify: rehype plugin rewrites — instead of `data-ordinal` from DB, walk `<a>` elements, detect `isTestFile(href)`, wrap link + parent statement; statements without links classified via `classifyByHeuristic` from shared |
| `web-ui/src/components/CoverageBar.tsx` | Modify: no change to component; only the callers' source data changes |
| `agent/src/jobs/cron/spec-test-linker.ts` | **Rename + rewrite** as `agent/src/jobs/cron/spec-coverage-backfill.ts`. Reuses segment + classify + judge pipeline; output is a PR per spec with suggested inline-link insertions, not DB writes. Drops `persistStatements` / `persistLinks` / `recordContentHash` / `getLastContentHash` / `judgeLink` LLM call **kept** (it now informs link suggestions, not row writes). |
| `agent/src/jobs/cron/spec-coverage-validate.ts` | NEW: lightweight validate pass. Parses markdown links from each spec, resolves href#Lline against `chunks.metadata`, opens PR comments on link rot |
| `agent/src/health.ts` | Modify: rename `/api/trigger/spec-test-linker` → `/api/trigger/spec-coverage-validate`. Replaces the post-ingest fan-out target |
| `agent/src/job-runner.ts` | Modify: dispatch entries → `spec_coverage_validate: validateJob, spec_coverage_backfill: backfillJob`; remove `spec_test_linker` |
| `terraform/modules/gke-mcp/agent-helm/values.yaml` | Modify: rename CronJob entry to `spec-coverage-backfill`; same Mon 11:00 UTC schedule. Add a daily `spec-coverage-validate` cron entry for sweep-mode validation (in addition to the post-ingest trigger) |
| `mcp-server/src/routes.ts` | Modify: remove `handleSpecCoverage`, `handleSpecCoverageStale`, `handleSpecCoveragePrepare`, `handleSpecCoveragePersist`. Repoint `handleIngest`'s fan-out to call `triggerAgentSpecCoverageValidate` |
| `mcp-server/src/spec-coverage-prepare.ts` | Delete |
| `mcp-server/src/spec-coverage-persist.ts` | Delete |
| `mcp-server/src/spec-coverage-stale.ts` | Delete |
| `mcp-server/src/index.ts` | Modify: remove `prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage` MCP tool registrations |
| `mcp-server/src/__tests__/spec-coverage*.test.ts` | Delete (or fold into validate/backfill tests as appropriate) |
| `.claude/skills/lore-link-coverage/` | Delete |
| `shared/src/spec-judge.ts` | **Keep** — backfill cron still uses `selectCandidates`, `judgeLink`, `argmaxByTest`, `hashSpecContent` for the suggestion pipeline |
| `shared/src/spec-segment.ts` + `test-paths.ts` | Keep unchanged — UI + cron share them |
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_drop_v2_spec_coverage_tables.sql` | NEW: drop `spec_statements`, `spec_test_links`, `spec_coverage_runs` per team schema (Phase 4) |
| `CLAUDE.md` | Modify: rewrite the spec-test-coverage paragraphs to describe v3; remove the `local-coverage-linker` MCP tool callouts |
| `agent/src/lib/spec-link-parser.ts` | NEW: pure helper — `parseTestLinksInStatement(text): {label, path, line}[]` extracts the inline parentheticals; shared by validate + backfill + UI |

## Acceptance Criteria

1. The per-repo specs page renders an `<a>` whose `href`'s path passes `isTestFile()` with the green `stmt-tested` class; regular links render unchanged. ([validated by `SpecDetails.test.tsx:17`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L17), [`test-paths.test.ts:4`](apps/web-ui/src/lib/test-paths.test.ts#L4))
2. A statement carrying ≥1 test link counts as `covered` in the `CoverageBar`; the headline percentage is `covered / (covered + uncovered)`, with `narrative` excluded from the denominator (same formula as v2). ([validated by `CoverageBar.test.tsx:7`](apps/web-ui/src/components/CoverageBar.test.tsx#L7))
3. A statement under a section heading the heuristic marks `untestable` (Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale, plus the H1 intro) renders grey and is counted as `narrative`. ([validated by `spec-coverage-derive.test.ts:43`](apps/web-ui/src/lib/spec-coverage-derive.test.ts#L43), [`spec-segment.test.ts:106`](apps/web-ui/src/lib/spec-segment.test.ts#L106))
4. A testable statement with no test link renders red and counts toward `uncovered`. ([validated by `SpecDetails.test.tsx:34`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L34))
5. Hovering a green statement reveals the linked test name(s) + source URL(s) extracted directly from the markdown link, no DB join. ([validated by `SpecDetails.test.tsx:126`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L126))
6. The per-repo specs page issues NO query against `spec_statements`, `spec_test_links`, or `spec_coverage_runs` (and the v3 cleanup migration drops these tables).
7. `parseTestLinksInStatement(text)` extracts every `(...[label](path#Lline)...)` token at the end of a statement; multiple links comma-separated inside one paren are parsed as a list. ([validated by `spec-link-parser.test.ts:26`](libs/shared/src/spec-link-parser.test.ts#L26), [`spec-link-parser.test.ts:26`](apps/web-ui/src/lib/spec-link-parser.test.ts#L26))
8. The cron `spec_coverage_validate` runs on every successful `/api/ingest` for a repo, parses each spec's links, resolves them against `{schema}.chunks` AST metadata, and opens a PR comment listing broken links when any exist. ([validated by `spec-coverage-validate-trigger.test.ts:18`](apps/mcp-server/src/routes/spec-coverage-validate-trigger.test.ts#L18), [`spec-coverage-validate.test.ts:77`](apps/agent/src/jobs/scheduled/spec-coverage-validate.test.ts#L77))
9. The cron `spec_coverage_backfill` runs weekly (Mon 11:00 UTC) and on demand, segments + classifies + judges each spec's testable un-linked statements, and **opens a PR per spec** adding the suggested `([validated by ...](path#Lline))` parentheticals; no DB writes. ([validated by `spec-coverage-backfill.test.ts:23`](apps/agent/src/jobs/cron/spec-coverage-backfill.test.ts#L23), [`spec-judge.test.ts:141`](libs/shared/src/spec-judge.test.ts#L141), [`spec-judge.test.ts:198`](libs/shared/src/spec-judge.test.ts#L198))
10. The v2 MCP tools (`prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage`), the persist API endpoints, and the `/lore-link-coverage` skill no longer exist in the repo.
11. The v2 migrations remain intact (no destructive in-place rewrite of migration history); Phase 4's new migration `NNNN_drop_v2_spec_coverage_tables.sql` drops the now-unused tables idempotently.
12. The cron's backfill PR is **the only** mechanism by which Lore writes a test link into the spec; everything else is read-only or comment-only.

## Limitations & Open Questions

1. **Backfill cost.** Existing specs across the org have ~zero markdown test links today. The first weekly backfill run will open one PR per spec with suggestions — potentially dozens of PRs at once. Mitigation: rate-limit the first run, or gate the backfill on a feature flag and ramp slowly. Document the burst.
2. **Multiple test links per statement.** Format A handles this via comma-separation inside one paren. The rehype detection wraps all of them; the popover lists all of them. Tested.
3. **Manually-added links may not match the cron's preferred format.** The validate pass tolerates any markdown link whose href passes `isTestFile()` — the parenthetical wrapper is the cron's emission style, not a requirement on the author. An author who writes `It [does the thing](src/x.test.ts#L42).` mid-statement also gets the green wrap.
4. **Link rot UX.** The validate pass posts PR comments; comments on closed PRs aren't visible. Need a fallback: if no open PR exists for the spec's repo, open a `link-rot` labelled issue. Tracked as F-validate-fallback.
5. **No pass/fail status.** Out of scope (v2 limitation carries). Coverage-ingestion (deferred spec) could later feed run-status into the UI.
6. **Statement segmentation determinism.** The cron and UI must agree on what counts as a statement (so the backfill PR's inserted parenthetical lands on the right statement). `segmentStatements()` from shared is deterministic; this AC is verified by the existing shared test suite.
7. **Cleanup of v2 data.** Phase 4 drops the tables. If a downstream tool reads them (none known), the drop is destructive. Audit before applying.
8. **Local-coverage-linker is superseded.** The BYO-compute persist apparatus shipped in PR #483/#484 is removed by Phase 4. Authors who started using `/lore-link-coverage` (none yet, since it shipped today) lose that flow. The migration story: their committed links in the DB are dropped along with the tables; they should re-add as markdown in spec.md.
9. **Coverage-ingestion remains deferred.** Could later feed the backfill cron's judge with execution-trace evidence (raising suggestion precision); not v3 scope.
