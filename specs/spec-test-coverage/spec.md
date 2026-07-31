# Feature Specification: Spec → Test Coverage (v3)

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Spec → Test Coverage                     |
| Status         | In Progress                                |
| Created        | 2026-06-01                               |
| Last redesign  | 2026-06-02 (v3, author-driven markdown links + cron-as-suggester) |
| Owner          | Platform Engineering                     |
| Supersedes     | `local-coverage-linker` (BYO-compute persist path); defers `coverage-ingestion` (decoupled from v3) |

Spec → Test Coverage (v3) makes author-written inline markdown links in `spec.md` the source of truth for spec-to-test linkage, colored at render time by the web UI, with a cron that validates links against test metadata and backfills suggestions via PR — retiring the v2 relational linker tables.

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
   ([validated by `lease-backends.test.ts:49`](libs/shared/src/project/leases/lease-backends.test.ts#L49),
   [`lease-backends.test.ts:163`](libs/shared/src/project/leases/lease-backends.test.ts#L163))
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

### Enforcement & rationale (CI linter)

The cron *proposes* links; a deterministic ESLint rule *requires* them,
closing the loop so a testable statement cannot ship un-linked without a
visible signal. This is the statement-side complement of the test-side
`lore/require-spec-link` rule (which fails a test that no statement
references) — same inline-link contract, read from the other direction.

`lore/require-statement-links` (`tools/eslint-plugin-lore/`) walks each
`spec.md` / ADR under `specs/**/spec.md` + `adrs/**/*.md` (the first
`@eslint/markdown` language block in the repo), reusing the same
`segmentStatements` + `classifyByHeuristic` + `parseTestLinksInStatement`
stack the UI and cron already agree on. A statement is flagged only when the
section heuristic calls it **testable** and it carries zero test links — the
narrative/intro exemptions above apply unchanged, so the linter and the
coverage bar never disagree about what counts as a gap.

Reporting is gated by lifecycle status, consistently for specs and ADRs, which
`parseDocStatus` folds into the same buckets. `statusTier` maps them: a
**rejected** (never accepted) or **retired** (shipped then superseded/removed)
doc skips the rule entirely; every other status — **shipped** (ADR `accepted`),
**draft** / **in-progress** (ADR `proposed`), or an absent status — **warns**. A
gap is a warning, not a hard failure, so an in-flight backlog never wedges CI; a
repo that wants hard enforcement can raise the rule to `error` once its specs
are backfilled. Statement start lines for the report location come from the
`line` field on `segmentStatements`.

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
| Enforcement | **ESLint `lore/require-statement-links`** — testable statement with no link → `warn`; a `rejected` or `retired` doc is skipped. Raise to `error` per repo once backfilled. | Deterministic, always-on CI signal that never wedges the pipeline; the statement-side mirror of the test-side `lore/require-spec-link` |
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

1. The per-repo specs page renders an `<a>` whose `href`'s path passes `isTestFile()` with the green `stmt-tested` class; regular links render unchanged. ([validated by `SpecDetails.test.tsx:27`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L27), [`test-paths.test.ts:4`](apps/web-ui/src/lib/test-paths.test.ts#L4))

2. A statement carrying ≥1 test link counts as `covered` in the `CoverageBar`; the headline percentage is `covered / (covered + uncovered)`, with `narrative` excluded from the denominator (same formula as v2). ([validated by `SpecCard.test.tsx:23`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L23))

3. A statement under a section heading the heuristic marks `untestable` (Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale, plus the H1 intro) renders grey and is counted as `narrative`. ([validated by `SpecDetails.test.tsx:99`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L99), [`spec-segment.test.ts:197`](apps/web-ui/src/lib/spec-segment.test.ts#L197))

4. A testable statement with no test link renders red and counts toward `uncovered`. ([validated by `SpecDetails.test.tsx:83`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L83))

5. Hovering a green statement reveals the linked test name(s) + source URL(s) extracted directly from the markdown link, no DB join. ([validated by `SpecDetails.test.tsx:191`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L191))

6. The per-repo specs page issues NO query against `spec_statements`, `spec_test_links`, or `spec_coverage_runs` (and the v3 cleanup migration drops these tables).
7. `parseTestLinksInStatement(text)` extracts every `(...[label](path#Lline)...)` token at the end of a statement; multiple links comma-separated inside one paren are parsed as a list; it returns `[]` when there is no trailing parenthetical or the paren holds no markdown links (or only non-test links), ignores mid-text links with no trailing paren, tolerates a trailing period after the paren, strips a leading slash and recognises the Go `_test.go` convention on the href, yields `line: null` for a link with no `#Lline` anchor, and collapses internal whitespace in the label. ([validated by `spec-link-parser.test.ts:22`](libs/shared/src/spec-link-parser.test.ts#L22), [`spec-link-parser.test.ts:22`](apps/web-ui/src/lib/spec-link-parser.test.ts#L22), [`no-paren`](apps/web-ui/src/lib/spec-link-parser.test.ts#L10), [`no-links`](apps/web-ui/src/lib/spec-link-parser.test.ts#L16), [`multi-comma`](apps/web-ui/src/lib/spec-link-parser.test.ts#L36), [`ignores-nontest`](apps/web-ui/src/lib/spec-link-parser.test.ts#L55), [`only-nontest`](apps/web-ui/src/lib/spec-link-parser.test.ts#L65), [`no-anchor`](apps/web-ui/src/lib/spec-link-parser.test.ts#L73), [`strip-slash`](apps/web-ui/src/lib/spec-link-parser.test.ts#L83), [`go-path`](apps/web-ui/src/lib/spec-link-parser.test.ts#L91), [`midtext-ignored`](apps/web-ui/src/lib/spec-link-parser.test.ts#L101), [`trailing-period`](apps/web-ui/src/lib/spec-link-parser.test.ts#L109), [`collapse-ws`](apps/web-ui/src/lib/spec-link-parser.test.ts#L117), [`no-paren`](libs/shared/src/spec-link-parser.test.ts#L10), [`no-links`](libs/shared/src/spec-link-parser.test.ts#L16), [`multi-comma`](libs/shared/src/spec-link-parser.test.ts#L36), [`ignores-nontest`](libs/shared/src/spec-link-parser.test.ts#L55), [`only-nontest`](libs/shared/src/spec-link-parser.test.ts#L65), [`no-anchor`](libs/shared/src/spec-link-parser.test.ts#L73), [`strip-slash`](libs/shared/src/spec-link-parser.test.ts#L83), [`go-path`](libs/shared/src/spec-link-parser.test.ts#L91), [`midtext-ignored`](libs/shared/src/spec-link-parser.test.ts#L101), [`trailing-period`](libs/shared/src/spec-link-parser.test.ts#L109), [`collapse-ws-shared`](libs/shared/src/spec-link-parser.test.ts#L117))

8. The cron `spec_coverage_validate` runs on every successful `/api/ingest` for a repo, parses each spec's links, and resolves each against `{schema}.chunks` AST metadata — passing on a covering chunk (or a file-level null line resolved by any chunk of the file, or a line link into a file whose chunks all lack line ranges: pre-v2-chunker output is unverifiable, not broken), flagging `file-missing`, `line-out-of-range` (judged only against the ranged chunks when ranged and range-less coexist), or a non-trailing link (only a genuine test-file link buried mid-prose counts — mid-prose source references, intra-doc anchors, absolute URLs, placeholder paths like `path/to/test.ts` or `<owner>`-style template segments, links quoted in inline code spans, and prose brackets that would fuse with the trailing parenthetical's first link are all legitimate spec prose, not rot), grouping the broken-link report by spec, capping the rendered report body under GitHub's 65,536-char issue limit by eliding whole trailing bullets behind an `…and N more broken link(s) truncated` line (never cutting mid-bullet; a spec heading whose bullets were all elided is skipped rather than rendered empty; small reports render uncapped and the total counts survive at the top), opening a PR comment listing broken links when any exist, and treating a `spec-link-rot`-labelled open issue as the already-filed fallback. ([validated by `spec-coverage-validate-trigger.test.ts:18`](apps/lore-api/src/api/routes/spec-coverage-validate-trigger.test.ts#L18), [`spec-coverage-validate.test.ts:92`](libs/shared/src/detect/spec-coverage-validate.test.ts#L92), [`resolve-covers`](libs/shared/src/detect/spec-coverage-validate.test.ts#L29), [`file-missing`](libs/shared/src/detect/spec-coverage-validate.test.ts#L37), [`line-out-of-range`](libs/shared/src/detect/spec-coverage-validate.test.ts#L45), [`null-line-file`](libs/shared/src/detect/spec-coverage-validate.test.ts#L54), [`null-line-missing`](libs/shared/src/detect/spec-coverage-validate.test.ts#L62), [`any-chunk-covers`](libs/shared/src/detect/spec-coverage-validate.test.ts#L70), [`rangeless-passes`](libs/shared/src/detect/spec-coverage-validate.test.ts#L246), [`ranged-still-judges`](libs/shared/src/detect/spec-coverage-validate.test.ts#L254), [`all-resolve`](libs/shared/src/detect/spec-coverage-validate.test.ts#L108), [`no-test-links`](libs/shared/src/detect/spec-coverage-validate.test.ts#L118), [`non-trailing`](libs/shared/src/detect/spec-coverage-validate.test.ts#L124), [`nt-anchor`](libs/shared/src/detect/spec-coverage-validate.test.ts#L295), [`nt-url`](libs/shared/src/detect/spec-coverage-validate.test.ts#L302), [`nt-placeholder`](libs/shared/src/detect/spec-coverage-validate.test.ts#L309), [`nt-template`](libs/shared/src/detect/spec-coverage-validate.test.ts#L316), [`nt-source-ref`](libs/shared/src/detect/spec-coverage-validate.test.ts#L323), [`nt-code-span`](libs/shared/src/detect/spec-coverage-validate.test.ts#L330), [`nt-bracket-fusion`](libs/shared/src/detect/spec-coverage-validate.test.ts#L337), [`nt-genuine`](libs/shared/src/detect/spec-coverage-validate.test.ts#L344), [`report-grouped`](libs/shared/src/detect/spec-coverage-validate.test.ts#L140), [`empty-report`](libs/shared/src/detect/spec-coverage-validate.test.ts#L171), [`report-cap`](libs/shared/src/detect/spec-coverage-validate.test.ts#L175), [`report-uncapped`](libs/shared/src/detect/spec-coverage-validate.test.ts#L207), [`empty-heading-skipped`](libs/shared/src/detect/spec-coverage-validate.test.ts#L265), [`issue-open`](libs/shared/src/detect/spec-coverage-validate.test.ts#L228), [`issue-none`](libs/shared/src/detect/spec-coverage-validate.test.ts#L234), [`issue-empty`](libs/shared/src/detect/spec-coverage-validate.test.ts#L240))

9. The cron `spec_coverage_backfill` runs weekly (Mon 11:00 UTC) and on demand, segments + classifies + judges each spec's testable un-linked statements, and **opens a PR per spec** adding the suggested `([validated by ...](path#Lline))` parentheticals; no DB writes. `proposeLinkInsertions` inserts the trailing parenthetical at the matched statement — composing a unified-diff preview, collapsing multiple suggestions for one statement into a single comma-separated paren, omitting the `#Lline` anchor when the line is null, returning content unchanged for no suggestions, and skipping an already-linked or drifted (statement_text not-found) suggestion — while `pickStatementsForBackfill` returns only the testable statements with no existing trailing link, excluding already-linked, untestable, or unclassified ones. ([validated by `spec-coverage-backfill.test.ts:28`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L28), [`spec-judge.test.ts:160`](libs/shared/src/spec-judge.test.ts#L160), [`spec-judge.test.ts:237`](libs/shared/src/spec-judge.test.ts#L237), [`diff-preview`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L44), [`skip-linked`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L56), [`skip-drift`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L72), [`collapse-paren`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L84), [`null-anchor`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L109), [`no-suggestions`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L119), [`pick-unlinked`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L141), [`pick-excl-linked`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L158), [`pick-excl-untestable`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L172), [`pick-all-linked`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L186), [`pick-none-testable`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L199), [`pick-no-classification`](libs/shared/src/detect/spec-coverage-backfill.test.ts#L209))

10. The v2 MCP tools (`prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage`), the persist API endpoints, and the `/lore-link-coverage` skill no longer exist in the repo.
11. The v2 migrations remain intact (no destructive in-place rewrite of migration history); Phase 4's new migration `NNNN_drop_v2_spec_coverage_tables.sql` drops the now-unused tables idempotently.
12. The cron's backfill PR is **the only** mechanism by which Lore writes a test link into the spec; everything else is read-only or comment-only.

13. The backfill judge pipeline is deterministic where it can be: `featureDir` extraction (feature folder under `specs/`, parent dir otherwise, null for a bare filename), slug-token directory affinity, cosine similarity (1 for identical, 0 for orthogonal / empty / length-mismatched / zero-magnitude vectors), pgvector-string parsing, assertion-name referencing (case-insensitive, skips names under three characters), symbol-name normalization, and `hashSpecContent` (stable 64-char sha-256, distinct per content) are pure; `selectCandidates` ranks assertion-overlap then directory affinity then embedding proximity, skips non-test files and chunks with no test name, dedups by test keeping the strongest signal, and caps at `maxCandidates` flagging truncation; `judgeLink` keeps the highest-scoring judgment per test and drops non-matches and sub-threshold scores; the re-run diff returns links and ordinals no longer confirmed this run. The LLM judge returns the model tool call's assertions (propagating the caller's `jobName` for cost accounting) or `[]` when the model yields no assertions field. ([validated by `spec-judge:21`](libs/shared/src/spec-judge.test.ts#L21), [validated by `spec-judge:27`](libs/shared/src/spec-judge.test.ts#L27), [validated by `spec-judge:31`](libs/shared/src/spec-judge.test.ts#L31), [validated by `spec-judge:37`](libs/shared/src/spec-judge.test.ts#L37), [validated by `spec-judge:46`](libs/shared/src/spec-judge.test.ts#L46), [validated by `spec-judge:55`](libs/shared/src/spec-judge.test.ts#L55), [validated by `spec-judge:63`](libs/shared/src/spec-judge.test.ts#L63), [validated by `spec-judge:67`](libs/shared/src/spec-judge.test.ts#L67), [validated by `spec-judge:71`](libs/shared/src/spec-judge.test.ts#L71), [validated by `spec-judge:76`](libs/shared/src/spec-judge.test.ts#L76), [validated by `spec-judge:87`](libs/shared/src/spec-judge.test.ts#L87), [validated by `spec-judge:93`](libs/shared/src/spec-judge.test.ts#L93), [validated by `spec-judge:97`](libs/shared/src/spec-judge.test.ts#L97), [validated by `spec-judge:103`](libs/shared/src/spec-judge.test.ts#L103), [validated by `spec-judge:112`](libs/shared/src/spec-judge.test.ts#L112), [validated by `spec-judge:118`](libs/shared/src/spec-judge.test.ts#L118), [validated by `spec-judge:125`](libs/shared/src/spec-judge.test.ts#L125), [validated by `spec-judge:129`](libs/shared/src/spec-judge.test.ts#L129), [validated by `spec-judge:133`](libs/shared/src/spec-judge.test.ts#L133), [validated by `spec-judge:171`](libs/shared/src/spec-judge.test.ts#L171), [validated by `spec-judge:187`](libs/shared/src/spec-judge.test.ts#L187), [validated by `spec-judge:196`](libs/shared/src/spec-judge.test.ts#L196), [validated by `spec-judge:208`](libs/shared/src/spec-judge.test.ts#L208), [validated by `spec-judge:247`](libs/shared/src/spec-judge.test.ts#L247), [validated by `spec-judge:254`](libs/shared/src/spec-judge.test.ts#L254), [validated by `spec-judge:267`](libs/shared/src/spec-judge.test.ts#L267), [validated by `spec-judge:273`](libs/shared/src/spec-judge.test.ts#L273), [validated by `spec-judge:280`](libs/shared/src/spec-judge.test.ts#L280), [validated by `spec-judge-llm:9`](libs/shared/src/spec-judge-llm.test.ts#L9), [validated by `spec-judge-llm:32`](libs/shared/src/spec-judge-llm.test.ts#L32), [validated by `spec-judge-llm:42`](libs/shared/src/spec-judge-llm.test.ts#L42))

14. Each spec card derives its title from the spec's first H1 (stripping the marker and any "Feature Specification:" prefix), falling back to the feature directory name and then the raw file path when there is no H1; its summary is the first non-heading, non-table prose paragraph — skipping a leading blockquote note or whitespace-only block, collapsing internal whitespace and joining wrapped lines, truncating with an ellipsis past the limit, and empty when the content is only headings, tables, and lists; a spec's chunks are joined in `metadata.chunk_index` order, falling back to ingest order for chunks without one (sorted last), with identical contents de-duplicated. ([validated by `spec-summary:9`](libs/shared/src/spec-summary.test.ts#L9), [validated by `spec-summary:18`](libs/shared/src/spec-summary.test.ts#L18), [validated by `spec-summary:27`](libs/shared/src/spec-summary.test.ts#L27), [validated by `spec-summary:33`](libs/shared/src/spec-summary.test.ts#L33), [validated by `spec-summary:39`](libs/shared/src/spec-summary.test.ts#L39), [validated by `spec-summary:46`](libs/shared/src/spec-summary.test.ts#L46), [validated by `spec-summary:52`](libs/shared/src/spec-summary.test.ts#L52), [validated by `spec-summary:60`](libs/shared/src/spec-summary.test.ts#L60), [validated by `spec-summary:64`](libs/shared/src/spec-summary.test.ts#L64), [validated by `spec-summary:73`](libs/shared/src/spec-summary.test.ts#L73), [validated by `spec-summary:82`](libs/shared/src/spec-summary.test.ts#L82), [validated by `spec-summary:91`](libs/shared/src/spec-summary.test.ts#L91), [validated by `spec-summary:101`](libs/shared/src/spec-summary.test.ts#L101), [validated by `spec-summary:110`](libs/shared/src/spec-summary.test.ts#L110))

15. `segmentStatements()` splits prose paragraphs into sentences and each list item into its own ordinal-stable statement — joining wrapped continuation lines, ending a continuation at a heading, table row, or code fence, dropping bare list markers, guarding against splitting on single-initial (`J. B.`) and `e.g.`/`i.e.` abbreviations or a lowercase next character, splitting after punctuation-only leading sentences, excluding headings/fenced code/tables, tracking the enclosing heading per statement, keeping a trailing or own-line markdown-link parenthetical attached to its statement, and returning an empty array for content with no statements. ([validated by `spec-segment:9`](apps/web-ui/src/lib/spec-segment.test.ts#L9), [`spec-segment:23`](apps/web-ui/src/lib/spec-segment.test.ts#L23), [`spec-segment:36`](apps/web-ui/src/lib/spec-segment.test.ts#L36), [`spec-segment:45`](apps/web-ui/src/lib/spec-segment.test.ts#L45), [`spec-segment:68`](apps/web-ui/src/lib/spec-segment.test.ts#L68), [`spec-segment:72`](apps/web-ui/src/lib/spec-segment.test.ts#L72), [`spec-segment:83`](apps/web-ui/src/lib/spec-segment.test.ts#L83), [`spec-segment:89`](apps/web-ui/src/lib/spec-segment.test.ts#L89), [`spec-segment:120`](apps/web-ui/src/lib/spec-segment.test.ts#L120), [`spec-segment:129`](apps/web-ui/src/lib/spec-segment.test.ts#L129), [`spec-segment:135`](apps/web-ui/src/lib/spec-segment.test.ts#L135), [`spec-segment:144`](apps/web-ui/src/lib/spec-segment.test.ts#L144), [`ss-sentences`](libs/shared/src/spec-segment.test.ts#L10), [`ss-continuations`](libs/shared/src/spec-segment.test.ts#L37), [`ss-excludes`](libs/shared/src/spec-segment.test.ts#L46), [`ss-abbrev`](libs/shared/src/spec-segment.test.ts#L77), [`ss-initials`](libs/shared/src/spec-segment.test.ts#L87), [`ss-lowercase`](libs/shared/src/spec-segment.test.ts#L96), [`ss-heading`](libs/shared/src/spec-segment.test.ts#L102), [`ss-ordinals`](libs/shared/src/spec-segment.test.ts#L124), [`ss-trailing-link`](libs/shared/src/spec-segment.test.ts#L134), [`ss-ownline-link`](libs/shared/src/spec-segment.test.ts#L143), [`ss-empty`](libs/shared/src/spec-segment.test.ts#L156))

16. `buildIntroOrdinals()` marks statements under the document's first heading, or with no enclosing heading at all, as intro; `classifyByHeuristic()` returns those intro ordinals untestable as `intro`, marks narrative doc sections (alternatives / research / personas / out-of-scope), the standard narrative headings (Problem Statement → background, Vision, Clarifications, Open Questions, Limitations, Rationale), and `Decision:`-prefixed or bare `See ADR-NNN` cross-reference statements untestable, and leaves everything else — unrecognised headings, a statement with no enclosing heading, a real functional requirement — testable. ([validated by `spec-segment:151`](apps/web-ui/src/lib/spec-segment.test.ts#L151), [`spec-segment:169`](apps/web-ui/src/lib/spec-segment.test.ts#L169), [`spec-segment:187`](apps/web-ui/src/lib/spec-segment.test.ts#L187), [`spec-segment:206`](apps/web-ui/src/lib/spec-segment.test.ts#L206), [`spec-segment:214`](apps/web-ui/src/lib/spec-segment.test.ts#L214), [`spec-segment:232`](apps/web-ui/src/lib/spec-segment.test.ts#L232), [`spec-segment:241`](apps/web-ui/src/lib/spec-segment.test.ts#L241), [`spec-segment:247`](apps/web-ui/src/lib/spec-segment.test.ts#L247), [`spec-segment:260`](apps/web-ui/src/lib/spec-segment.test.ts#L260), [`cbh-intro-first`](libs/shared/src/spec-segment.test.ts#L163), [`cbh-no-heading`](libs/shared/src/spec-segment.test.ts#L181), [`cbh-intro`](libs/shared/src/spec-segment.test.ts#L200), [`cbh-background`](libs/shared/src/spec-segment.test.ts#L211), [`cbh-vision`](libs/shared/src/spec-segment.test.ts#L220), [`cbh-clarification`](libs/shared/src/spec-segment.test.ts#L226), [`cbh-open-question`](libs/shared/src/spec-segment.test.ts#L232), [`cbh-limitation`](libs/shared/src/spec-segment.test.ts#L238), [`cbh-rationale`](libs/shared/src/spec-segment.test.ts#L246), [`cbh-unrecognised`](libs/shared/src/spec-segment.test.ts#L252), [`cbh-decision`](libs/shared/src/spec-segment.test.ts#L271), [`cbh-xref`](libs/shared/src/spec-segment.test.ts#L286), [`cbh-narrative`](libs/shared/src/spec-segment.test.ts#L298), [`cbh-functional`](libs/shared/src/spec-segment.test.ts#L313))

17. `parseCodeLinksInStatement()` extracts the trailing parenthetical as a non-test code reference, excluding markdown doc links so an ADR ref is not a code link; `linksForStatements()` pairs each segmented statement with its parsed test links; `findMisplacedCoverageLinks()` flags a test-file coverage link buried in a non-trailing parenthetical while ignoring one correctly in the trailing paren, a non-trailing prose doc link, an intra-doc anchor, an absolute URL, a placeholder or `<owner>`-style template path, a mid-prose source-file reference, a link quoted inside an inline code span, and a prose bracket that would otherwise fuse with the trailing parenthetical's first link. ([validated by `spec-link-parser:127`](apps/web-ui/src/lib/spec-link-parser.test.ts#L127), [`spec-link-parser:137`](apps/web-ui/src/lib/spec-link-parser.test.ts#L137), [`spec-link-parser:147`](apps/web-ui/src/lib/spec-link-parser.test.ts#L147), [`spec-link-parser:175`](apps/web-ui/src/lib/spec-link-parser.test.ts#L175), [`spec-link-parser:185`](apps/web-ui/src/lib/spec-link-parser.test.ts#L185), [`spec-link-parser:193`](apps/web-ui/src/lib/spec-link-parser.test.ts#L193), [`pcl-single`](libs/shared/src/spec-link-parser.test.ts#L127), [`pcl-excl-doc`](libs/shared/src/spec-link-parser.test.ts#L137), [`pcl-other-lang`](libs/shared/src/spec-link-parser.test.ts#L145), [`lfs-pairs`](libs/shared/src/spec-link-parser.test.ts#L157), [`fmcl-buried`](libs/shared/src/spec-link-parser.test.ts#L185), [`fmcl-trailing-ok`](libs/shared/src/spec-link-parser.test.ts#L195), [`fmcl-prose-doc`](libs/shared/src/spec-link-parser.test.ts#L203), [`fmcl-anchor`](apps/web-ui/src/lib/spec-link-parser.test.ts#L201), [`fmcl-url`](apps/web-ui/src/lib/spec-link-parser.test.ts#L209), [`fmcl-placeholder`](apps/web-ui/src/lib/spec-link-parser.test.ts#L217), [`fmcl-source-ref`](apps/web-ui/src/lib/spec-link-parser.test.ts#L225), [`fmcl-code-span`](apps/web-ui/src/lib/spec-link-parser.test.ts#L233), [`fmcl-bracket-fusion`](apps/web-ui/src/lib/spec-link-parser.test.ts#L241))

18. `parseSpecStatus()` reads the `| Status |` table row (case-insensitive label, bold or plain, ignoring a non-table line that merely contains the word Status), keeping the leading word as label and bucketing it into `shipped` (Shipped / Complete / Implemented), `draft`, `in-progress` (In Progress / In review), `retired` (Retired / Removed / superseded), or `rejected` — dropping any trailing suffix and returning null for a missing row or unrecognised value; `matchesSpecStatusFilter()` matches everything (including unparsed specs) on `all` and only the selected bucket otherwise. ([validated by `spec-status`](apps/web-ui/src/lib/spec-status.test.ts))

19. The per-repo `SpecListView` counts folder statuses into chips that filter the cards when clicked, and the global doc browsers (`/specs` and `/adrs`, one shared `GlobalDocsView`) group docs by repo — linking each path to its per-repo detail page, spec or adr by `kind` — count statuses into chips that filter the list (the adr kind swapping in the frontmatter legend), narrow to a typed search text, and show the page's empty-state and no-match hints. ([validated by `SpecListView:50`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L50), [`SpecListView:55`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L55), [`GlobalDocsView:7`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L7), [`GlobalDocsView:28`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L28), [`GlobalDocsView:39`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L39), [`GlobalDocsView:68`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L68), [`GlobalDocsView:89`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L89), [`GlobalDocsView:109`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L109), [`GlobalDocsView:128`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L128))

20. `SpecCard` renders its title and a Details link pointing at the given `detailsHref`, and `SpecDocument` renders one framed `data-doc-section` card per markdown section. ([validated by `SpecCard:7`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L7), [`SpecDocument:8`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/[...path]/SpecDocument.test.tsx#L8))

21. `resolveHref()` rewrites a repo-relative path (stripping a leading `./`) to a `github.com/<owner>/<repo>/blob/<branch>/<path>` URL marked external on the given branch, leaves an absolute https URL external, and leaves an in-page `#anchor`, a relative path when the repo is not `owner/name`, and an empty href unchanged and not external; `SpecDetails` renders an inline test link as that absolute GitHub URL opening in a new tab (`target=_blank`, `rel=noopener noreferrer`), rewrites a non-test ADR author link the same way without the test-link cue, and leaves links relative (no new tab) when the repo is not `owner/name`. ([validated by `resolveHref:326`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L326), [`resolveHref:335`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L335), [`resolveHref:341`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L341), [`resolveHref:347`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L347), [`resolveHref:356`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L356), [`resolveHref:363`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L363), [`resolveHref:370`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L370), [`SpecDetails:117`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L117), [`SpecDetails:148`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L148), [`SpecDetails:171`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L171))

22. `SpecDetails` marks a drifted statement's `<mark>` with `data-drifted="true"` and surfaces a drift notice in its hover popover, keeps the statement highlight stable across re-renders, wraps statements spanning inline bold, inline code, or a code span containing literal link/emphasis syntax with `stmt-tested`, and renders none of the legacy DB-driven `tests[]` list, `TestLink` prop, or list-only/legacy badges. ([validated by `SpecDetails:46`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L46), [`SpecDetails:213`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L213), [`SpecDetails:232`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L232), [`SpecDetails:244`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L244), [`SpecDetails:264`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L264), [`SpecDetails:284`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L284), [`SpecDetails:305`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L305))
23. Enforcement support in `@re-cinq/lore-shared`: `segmentStatements()` stamps each statement's 1-based source start line (the paragraph line for a sentence, the marker line for a list item, shared across sentences split from one paragraph) so the `require-statement-links` rule can report at the offending line; `parseDocStatus()` normalizes a spec's `| Status |` table row or an ADR's frontmatter `status:` (read only inside the `---` block) into one of five buckets — `draft`, `in-progress` (ADR `proposed`), `shipped` (folding Shipped / Implemented / Complete / Accepted / Done / Live and ADR `accepted`, stripping bold markers and trailing prose), `retired` (Retired / Removed / ADR `superseded` — shipped then terminated), `rejected` (never accepted), or `null` for an absent/unrecognised value; and `statusTier()` maps those to the report gate — `rejected` and `retired` skip, every other status (shipped / draft / in-progress / unknown) warns. ([validated by `ss-line`](libs/shared/src/spec-segment.test.ts#L330), [`spec-status`](libs/shared/src/spec-status.test.ts))


24. `GlobalDocsView` is a client component rendered by the `/specs` and `/adrs` server components, so those pages pass it only serializable props — a function prop fails the render at runtime, with the message redacted in production builds. ([validated by `specs boundary`](apps/web-ui/src/app/global-docs-boundary.test.tsx#L45), [`adrs boundary`](apps/web-ui/src/app/global-docs-boundary.test.tsx#L51))

25. The global and per-repo doc list endpoints return each document's lifecycle pill (`docStatusPill`) alongside the list, so a list page resolves statuses in its one API call instead of one source fetch per document — a fan-out that put a single `/specs` render at 114 requests against the API's shared 200/min `default` bucket. ([validated by `docStatusPill`](libs/shared/src/spec-status.test.ts#L321))
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
