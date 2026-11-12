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

> **Amended 2026-10-02.** The cron side of this spec is gone: the validate pass and the backfill suggester (`libs/shared/src/work/detect/`) ran on the engine Lore ran itself and were deleted with it. A broken link is caught by the `spec-links` check on the pull request that breaks it, and missing links are added by the weekly `spec-upkeep` line on the external floor (`specs/external-floor` FR14). Statements below about the validate cron or the backfill line describe what was.

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
_(Added 2026-10-01.)_ Where an external floor is configured, the weekly backfill of links is done by the `spec-upkeep` line (`specs/external-floor` FR14) instead of `spec-coverage-backfill`: a station lists the testable statements no test validates from the graph, and an agent with the repository checked out judges each candidate test by reading it and adds the link. ([validated by finds the testable statement of specs/cart/spec.md that no test validates @778d6a4f](../../libs/shared/src/work/spec-upkeep/findings.test.ts#L163))

## Acceptance Criteria

1. The runner claims a pending task before GKE picks it up.
   ([validated by runner.local.test.ts:91 @ae47e120](apps/mcp-server/src/work/pipeline/runner.local.test.ts#L91))
2. Tasks survive rollout restarts via the lease backend.
   ([validated by `lease-backends.test.ts@36c9466c`](libs/shared/src/outbound/project/leases/lease-backends.test.ts#L14),
   [`lease-backends.test.ts@7b23ea8c`](libs/shared/src/outbound/project/leases/lease-backends.test.ts#L142))
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
  `tested`. ([validated by determines a statement is tested by finding a test link mid-statement, overriding a graph state of untested @37adb0b0](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.acceptance.test.tsx#L13))
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
`re-lint/require-spec-link` rule (which fails a test that no statement
references) — same inline-link contract, read from the other direction.

`re-lint/require-statement-links` (`@re-cinq/eslint-plugin-re-lint`) walks each
`spec.md` / ADR under `specs/**/spec.md` + `adrs/**/*.md` (the first
`@eslint/markdown` language block in the repo), reusing the same
`segmentStatements` + `classifyByHeuristic` + `parseTestLinksInStatement`
stack the UI and cron already agree on. A statement is flagged only when the
section heuristic calls it **testable** and it carries zero test links — the
narrative/intro exemptions above apply unchanged, so the linter and the
coverage bar never disagree about what counts as a gap.

A link that points nowhere is caught on the pull request that broke it: the
`spec-links` job of `.github/workflows/pr-checks.yml` runs `lore-code-trace
links` (acceptance criteria 29 to 35) after the `format` job, against the base
branch of the pull request, so the check judges the head that carries the
links the pull request wrote, hashed and re-anchored; every other link is
repointed after the merge by the `spec-link-upkeep` workflow. A pull request from a fork runs without the repository's
secrets, so its links are not checked: the job says so in a warning and passes.

Reporting is gated by lifecycle status, consistently for specs and ADRs, which
`parseDocStatus` folds into the same buckets. `statusTier` maps them: a
**rejected** (never accepted) or **retired** (shipped then superseded/removed)
doc skips the rule entirely; every other status — **shipped** (ADR `accepted`),
**draft** / **in-progress** (ADR `proposed`), or an absent status — **warns**. A
gap is a warning, not a hard failure, so an in-flight backlog never wedges CI; a
repo that wants hard enforcement can raise the rule to `error` once its specs
are backfilled. Statement start lines for the report location come from the
`line` field on `segmentStatements`.

### Anchor hashes (amended 2026-11-05)

A `#Lnn` anchor names a line by number, so every insertion above the cited line broke the link and failed the branch that moved the code. A link now also names its line by content: its label ends in the anchor hash of the cited line, and the `#Lnn` stays only so GitHub and editors open the file there.

- The anchor hash of a line is the first 8 hex characters of the sha256 of the line lowercased with every character but `a-z` and `0-9` removed, so the same line hashes the same in any language and through quoting, spacing and case; lore, re-lint and lore-code-trace compute it alike. ([validated by normalizes and hashes every line of the fixtures re-lint and lore-code-trace share @bc3b348b](libs/shared/src/domain/anchor-hash.test.ts#L11), [validated by TestAnchorHashMatchesTheFixturesLoreAndReLintShare @cc6ff565](apps/lore-code-trace/anchor_hash_test.go#L16), [validated by returns null for a closing line @6b95bb9b](libs/shared/src/domain/anchor-hash.test.ts#L21))
- A label ending in `@` and 8 hex characters carries that hash, and the parser reads it beside the path and line. ([validated by parses to src/a.test.ts line 12 with hash a3f9c1d2 @26990d5a](libs/shared/src/domain/spec-link-parser.test.ts#L470), [validated by returns the backticked file name and hash a3f9c1d2 @ebf78803](libs/shared/src/domain/spec-link-parser.test.ts#L392), [validated by returns the validated-by title and hash a3f9c1d2 @2427ea40](libs/shared/src/domain/spec-link-parser.test.ts#L399), [validated by returns no hash for a file:line label, a bare prefix and a 7-character suffix @9e64aeed](libs/shared/src/domain/spec-link-parser.test.ts#L406))
- The hash goes inside a closing code span and replaces the `:NN` a file label carried, since that number goes stale and the hash does not. ([validated by puts the hash inside a closing code span after a prefix, dropping its :38 @072d7996](libs/shared/src/domain/spec-link-parser.test.ts#L453), [validated by appends inside backticks, after a prefix, and replaces an old hash @62860d09](libs/shared/src/domain/spec-link-parser.test.ts#L439))
- Writing a hash into a label twice gives the same label, so the fixer's second pass changes nothing. ([validated by rewrites a bare file label and its own output to the same hashed file label @fee7defa](libs/shared/src/domain/spec-link-parser.test.ts#L459))
- A hashed link means the line of the cited file carrying its hash, nearest the written line. ([validated by returns line 3, where the hash now sits, for a link written at line 1 @050d7a46](libs/shared/src/domain/spec-trace/resolve-anchor-line.test.ts#L10), [validated by returns lines 1 and 3 of a source that repeats the hashed line @81597803](libs/shared/src/domain/anchor-hash.test.ts#L27), [validated by returns 40 near 30 and 10 near 25 from lines 10 and 40 @2bdf6259](libs/shared/src/domain/anchor-hash.test.ts#L37))
- When no line of the cited file carries its hash, the link means the line it was written with. ([validated by returns the written line 7 for a hash no line carries @c2a3fd15](libs/shared/src/domain/spec-trace/resolve-anchor-line.test.ts#L14), [validated by returns the written line 7 for a link with no hash @77a0e87f](libs/shared/src/domain/spec-trace/resolve-anchor-line.test.ts#L18), [validated by returns the written line 7 when the cited file cannot be read @bde92473](libs/shared/src/domain/spec-trace/resolve-anchor-line.test.ts#L22))
- The graph stores a hashed test link at the line its hash sits on in the file at the ingested commit, with the hash. ([validated by stores a hashed test link at line 3, where its hash now sits, with the hash @6deb0229](libs/shared/src/work/spec-trace/project-spec-file.test.ts#L421))
- The graph keys a hashed code link by repository, path and hash, so its chunk keeps its identity when the cited line moves. ([validated by keys a hashed code link by repo|path|hash, so the chunk keeps its xid when the line moves @36fbe282](libs/shared/src/work/spec-trace/project-spec-file.test.ts#L448))
- The ingest hands the spec projector the commit of the delta, where it reads the files a spec's links cite. ([validated by hands the projector the delta's commit, where the files a spec's links cite are read @42ab44e9](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L833))
- lore-code-trace stamps each test descriptor with the hash of its declaration line. ([validated by TestStampAnchorHashesHashesTheDeclarationLineAndSkipsAMissingFile @b6628a35](apps/lore-code-trace/anchor_hash_test.go#L39))
- A link whose hash is a test's declaration hash binds that test, wherever its written line lies. ([validated by binds a link whose stale line 99 lies outside every test by its hash aaaaaaaa @f1ecde97](libs/shared/src/work/spec-trace/bind-descriptors-to-spec-links.test.ts#L143), [validated by binds the farewell statement, not the greeting one, to a second descriptor whose declaration hash is bbbbbbbb @739c9fba](libs/shared/src/work/spec-trace/bind-descriptors-to-spec-links.test.ts#L158))
- A link whose hash is no test's declaration, one citing a line in a test's body, binds by its line falling in the test's span. ([validated by binds a hashed link citing a line in a test's body by that line's range @a32fd370](libs/shared/src/work/spec-trace/bind-descriptors-to-spec-links.test.ts#L176))
- The Utopia mirror names the test a hashed link cites by the title declared at the line its hash sits on. ([validated by names the test at the line its hash sits on, line 2, though the link says 40 @e7e3278d](libs/shared/src/domain/utopia/docs/doc-statements.test.ts#L313), [validated by returns a titled link's path when the link carries a hash @542fee18](libs/shared/src/domain/utopia/docs/doc-statements.test.ts#L299))
- The web UI reads a test link's hash from its label, so the statement popover knows which links name their line by content. ([validated by reads hash a3f9c1d2 from a hashed label and null from a plain one @6d7c638f](../../apps/web-ui/src/lib/trace-statement-info.test.ts#L85))
- A test pushed to Utopia from a run carries its anchor hash when its descriptor has one. ([validated by returns anchor_hash a3f9c1d2 for a test whose descriptor carries it, and none for one that does not @e757ea33](libs/shared/src/domain/utopia/test-coverage/test-report-statements.test.ts#L166))

The fixer is re-lint's, documented in its README under "Anchor hashes". `no-stale-spec-links` adds the hash and repoints a link: to the line carrying its hash; to the line a same-size rewrite put in its place, a test renamed where it stood; or to the one line keeping at least 60% of the old line's character pairs, in the cited file or the file git says it was renamed to. Lore runs it as a warning on the links a pull request writes only (`scope: "authored"`); the `spec-link-upkeep` workflow repoints every other link after each merge to main in a pull request of its own, healing renames against the main commit it last processed. `no-rotten-spec-links`, an error, reports only a link nothing can repoint.

### Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth | **Markdown links in `spec.md`** | Git-tracked, author-reviewed, no hallucination, PR-co-located |
| Link format | **Inline parenthetical at end of statement**: `Statement text. ([label @hash](path#Lline))`, the hash naming the line by content (see Anchor hashes) | Lowest visual noise; works for prose + lists; rehype detects deterministically; multiple links comma-separated inside one paren |
| Test-file detection | Reuse `isTestFile()` from `@re-cinq/lore-shared` on the `<a>` href's path component | Same heuristic the v2 linker used; one shared source of truth |
| Statement segmentation | Reuse `segmentStatements()` + `classifyByHeuristic()` from `@re-cinq/lore-shared` | The ordinal contract still applies — UI + cron must agree on what counts as a statement |
| Server-side state | **None.** The v2 tables (`spec_statements`, `spec_test_links`, `spec_coverage_runs`) are scheduled for deletion | Spec authors update the file; UI reads it; cron proposes via PR |
| Cron — validate | **Runs on every ingest** (replaces the v2 fan-out webhook trigger). Pure resolution against `chunks`; no LLM. Outputs broken-link reports as PR comments. | Cheap; catches link rot promptly |
| Cron — backfill | **Weekly schedule + manual trigger**. Runs the v2 judge pipeline but emits its output as **PR edits to `spec.md`**, not DB rows | Expensive; weekly is right cadence |
| Backfill output target | **PR against the spec's own repo** adding the suggested markdown links inline | Author reviews in their normal git flow; no UI for "accept/reject suggestions" needed |
| Validation output target | **PR comment** on the most recent open PR touching the spec, or an issue if none exists | Surfaces link rot at the right moment |
| Enforcement | **ESLint `re-lint/require-statement-links`** — testable statement with no link → `warn`; a `rejected` or `retired` doc is skipped. Raise to `error` per repo once backfilled. | Deterministic, always-on CI signal that never wedges the pipeline; the statement-side mirror of the test-side `re-lint/require-spec-link` |
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
    +     ([validated by runner.local.test.ts:146 @a8ee69ed](apps/mcp-server/src/work/pipeline/runner.local.test.ts#L146))

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
  (intro / vision / limitation / etc.). ([validated by surfaces the narrative section category in the hover popover @03668910](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.acceptance.test.tsx#L34))

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

1. The per-repo specs page renders an `<a>` whose `href`'s path passes `isTestFile()` with the green `stmt-tested` class; regular links render unchanged. ([validated by `SpecDetails.test.tsx@82e6861a`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L27), [validated by @37adb0b0](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.acceptance.test.tsx#L13))

2. A statement carrying ≥1 test link counts as `covered` in the `CoverageBar`; the headline percentage is `covered / (covered + uncovered)`, with `narrative` excluded from the denominator (same formula as v2). ([validated by `SpecCard.test.tsx@d5943b85`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L23))

3. A statement under a section heading the heuristic marks `untestable` (Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale, plus the H1 intro) renders grey and is counted as `narrative`. ([validated by `SpecDetails.test.tsx@6489ee5f`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L131), [validated by @03668910](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.acceptance.test.tsx#L34))

4. A testable statement with no test link renders red and counts toward `uncovered`. ([validated by `SpecDetails.test.tsx@d2f6c3e0`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L115))

5. Hovering a green statement reveals the linked test name(s) + source URL(s) extracted directly from the markdown link, no DB join. ([validated by `SpecDetails.test.tsx@3270c624`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L224), [validated by renders a statement with multiple test links as tested and shows all links in the hover popover @07bbac6e](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L46))

6. The per-repo specs page issues NO query against `spec_statements`, `spec_test_links`, or `spec_coverage_runs` (and the v3 cleanup migration drops these tables), and renders no Add Spec form because specs are projected automatically by CI on push.
7. `parseTestLinksInStatement(text)` extracts every `(...[label](path#Lline)...)` token at the end of a statement; multiple links comma-separated inside one paren are parsed as a list; every link group run up against the last one is read too, so `([validated by …](a.test.ts#L<line>)) ([from plan](…))` keeps its test link, while a prose aside before the groups is not evidence *(amended 2026-10-26, as re-lint 1.9.0 reads it)*; it returns `[]` when there is no trailing parenthetical or the paren holds no markdown links (or only non-test links), ignores mid-text links with no trailing paren, tolerates a trailing period after the paren, strips a leading slash and recognises the Go `_test.go` convention on the href, yields `line: null` for a link with no `#Lline` anchor, and collapses internal whitespace in the label. ([validated by `spec-link-parser.test.ts@b9be5017`](libs/shared/src/domain/spec-link-parser.test.ts#L27), [`no-paren@c28cb9f6`](libs/shared/src/domain/spec-link-parser.test.ts#L15), [`no-links@dfb2d28d`](libs/shared/src/domain/spec-link-parser.test.ts#L21), [`multi-comma@c5ec763e`](libs/shared/src/domain/spec-link-parser.test.ts#L42), [`ignores-nontest@6f45d21e`](libs/shared/src/domain/spec-link-parser.test.ts#L63), [`only-nontest@c9b0d66b`](libs/shared/src/domain/spec-link-parser.test.ts#L78), [`no-anchor@8ea355e8`](libs/shared/src/domain/spec-link-parser.test.ts#L86), [`strip-slash@fdbc52d5`](libs/shared/src/domain/spec-link-parser.test.ts#L96), [`go-path@7d6189bb`](libs/shared/src/domain/spec-link-parser.test.ts#L104), [`midtext-ignored@c3b50c4b`](libs/shared/src/domain/spec-link-parser.test.ts#L114), [`trailing-period@e4b46f1f`](libs/shared/src/domain/spec-link-parser.test.ts#L122), [`collapse-ws-shared@7c5ae4a6`](libs/shared/src/domain/spec-link-parser.test.ts#L132), [validated by reads a.test.ts#L3 from the group before a from-plan group @3bdd5311](libs/shared/src/domain/spec-link-parser.test.ts#L364), [validated by reports no misplaced link for it, and cuts both groups off the statement @60045e94](libs/shared/src/domain/spec-link-parser.test.ts#L375), [validated by still reads no link from a prose aside before the last group @de380462](libs/shared/src/domain/spec-link-parser.test.ts#L382), [validated by handles malformed unbalanced groups explicitly without silent coverage loss, and ignores an unparenthesized trailing link after an unmatched paren @eacd4051](libs/shared/src/domain/spec-link-parser.acceptance.test.ts#L8), [validated by retains a valid dotted backtick label through linksForStatements without silent coverage loss (Number.MAX_SAFE_INTEGER regression) @efddb6d1](libs/shared/src/domain/spec-link-parser.acceptance.test.ts#L30))

8. *(Amended 2026-10-02, `specs/external-floor` FR16.6 / FR16.15.)* `spec_coverage_validate` is retired: neither its daily `cron.spec_coverage_validate.tick` nor its post-ingest trigger is emitted, and the chunk-based link validator, its PR-comment report, and its `spec-link-rot` open-issue fallback (`F-validate-fallback`) are deleted; broken spec links are caught on the pull request that breaks them by the `spec-links` check (`lore-code-trace links`, acceptance criteria 29–35). ([validated by names no tick for gap_detection, spec_drift, spec_coverage_backfill or spec_coverage_validate, whose lines only the old Floor walked @2982c8a8](libs/shared/src/work/scheduler/cron-emitters.test.ts#L5), [validated by returns 200 and inserts no event when a file lands @0bb0e40f](apps/lore-api/src/transport/routes/ingest/ingest.test.ts#L54))

9. *(Since 2026-10-02 nothing schedules this pass either: `spec-upkeep` on the external floor adds missing links, `specs/external-floor` FR14.)* `spec_coverage_backfill` segments + classifies + judges each spec's testable un-linked statements, and **opens a PR per spec** adding the suggested `([validated by ...](path#Lline))` parentheticals; no DB writes. `proposeLinkInsertions` inserts the trailing parenthetical at the matched statement — composing a unified-diff preview, collapsing multiple suggestions for one statement into a single comma-separated paren, omitting the `#Lline` anchor when the line is null, returning content unchanged for no suggestions, and skipping an already-linked or drifted (statement_text not-found) suggestion — while `pickStatementsForBackfill` returns only the testable statements with no existing trailing link, excluding already-linked, untestable, or unclassified ones. ([`spec-judge.test.ts@d8689678`](libs/shared/src/domain/spec-judge.test.ts#L160), [`spec-judge.test.ts@88c25462`](libs/shared/src/domain/spec-judge.test.ts#L237))

10. The v2 MCP tools (`prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage`), the persist API endpoints, and the `/lore-link-coverage` skill no longer exist in the repo.
11. The v2 migrations remain intact (no destructive in-place rewrite of migration history); Phase 4's new migration `NNNN_drop_v2_spec_coverage_tables.sql` drops the now-unused tables idempotently. ([validated by drops all three tables across affected schemas and a second execution succeeds @4f7d3577](apps/lore-api/src/integration-tests/drop-v2-spec-coverage-tables.acceptance.test.ts#L19))
12. The cron's backfill PR is **the only** mechanism by which Lore writes a test link into the spec; everything else is read-only or comment-only.

13. The backfill judge pipeline is deterministic where it can be: `featureDir` extraction (feature folder under `specs/`, parent dir otherwise, null for a bare filename), slug-token directory affinity, cosine similarity (1 for identical, 0 for orthogonal / empty / length-mismatched / zero-magnitude vectors), pgvector-string parsing, assertion-name referencing (case-insensitive, skips names under three characters), symbol-name normalization, and `hashSpecContent` (stable 64-char sha-256, distinct per content) are pure; `selectCandidates` ranks assertion-overlap then directory affinity then embedding proximity, skips non-test files and chunks with no test name, dedups by test keeping the strongest signal, and caps at `maxCandidates` flagging truncation; `judgeLink` keeps the highest-scoring judgment per test and drops non-matches and sub-threshold scores; the re-run diff returns links and ordinals no longer confirmed this run. The LLM judge returns the model tool call's assertions (propagating the caller's `jobName` for cost accounting) or `[]` when the model yields no assertions field. ([validated by `spec-judge@6699aeaa`](libs/shared/src/domain/spec-judge.test.ts#L21), [validated by `spec-judge@1ec1d3ce`](libs/shared/src/domain/spec-judge.test.ts#L27), [validated by `spec-judge@e968ebbb`](libs/shared/src/domain/spec-judge.test.ts#L31), [validated by `spec-judge@8ef9a2a3`](libs/shared/src/domain/spec-judge.test.ts#L37), [validated by `spec-judge@7dc307c1`](libs/shared/src/domain/spec-judge.test.ts#L46), [validated by `spec-judge@9fd4d3d9`](libs/shared/src/domain/spec-judge.test.ts#L55), [validated by `spec-judge@cf113346`](libs/shared/src/domain/spec-judge.test.ts#L63), [validated by `spec-judge@74f4c3d1`](libs/shared/src/domain/spec-judge.test.ts#L67), [validated by `spec-judge@6d78a110`](libs/shared/src/domain/spec-judge.test.ts#L71), [validated by `spec-judge@ee91cc03`](libs/shared/src/domain/spec-judge.test.ts#L76), [validated by `spec-judge@6680781c`](libs/shared/src/domain/spec-judge.test.ts#L87), [validated by `spec-judge@cc66ebfc`](libs/shared/src/domain/spec-judge.test.ts#L93), [validated by `spec-judge@1d59219b`](libs/shared/src/domain/spec-judge.test.ts#L97), [validated by `spec-judge@04556d44`](libs/shared/src/domain/spec-judge.test.ts#L103), [validated by `spec-judge@d575adf9`](libs/shared/src/domain/spec-judge.test.ts#L112), [validated by `spec-judge@6614fdb1`](libs/shared/src/domain/spec-judge.test.ts#L118), [validated by `spec-judge@3c4f6cab`](libs/shared/src/domain/spec-judge.test.ts#L125), [validated by `spec-judge@20ca70c8`](libs/shared/src/domain/spec-judge.test.ts#L129), [validated by `spec-judge@09de031e`](libs/shared/src/domain/spec-judge.test.ts#L133), [validated by `spec-judge@a1155aab`](libs/shared/src/domain/spec-judge.test.ts#L171), [validated by `spec-judge@552b49b4`](libs/shared/src/domain/spec-judge.test.ts#L187), [validated by `spec-judge@ff30cdcf`](libs/shared/src/domain/spec-judge.test.ts#L196), [validated by `spec-judge@e325ad4a`](libs/shared/src/domain/spec-judge.test.ts#L208), [validated by `spec-judge@68157b8b`](libs/shared/src/domain/spec-judge.test.ts#L247), [validated by `spec-judge@8022e5ab`](libs/shared/src/domain/spec-judge.test.ts#L254), [validated by `spec-judge@9cb5c9e6`](libs/shared/src/domain/spec-judge.test.ts#L267), [validated by `spec-judge@d9bdc482`](libs/shared/src/domain/spec-judge.test.ts#L273), [validated by `spec-judge@af6d500d`](libs/shared/src/domain/spec-judge.test.ts#L280), [validated by `spec-judge-llm@50fc3ccb`](libs/shared/src/work/spec-judge-llm.test.ts#L9), [validated by `spec-judge-llm@2c60d33c`](libs/shared/src/work/spec-judge-llm.test.ts#L32), [validated by `spec-judge-llm@7d799ca1`](libs/shared/src/work/spec-judge-llm.test.ts#L42))

14. Each spec card derives its title from the spec's first H1 (stripping the marker and any "Feature Specification:" prefix), falling back to the feature directory name and then the raw file path when there is no H1; its summary is the first non-heading, non-table prose paragraph — skipping a leading blockquote note or whitespace-only block, collapsing internal whitespace and joining wrapped lines, truncating with an ellipsis past the limit, and empty when the content is only headings, tables, and lists; a spec's chunks are joined in `metadata.chunk_index` order, falling back to ingest order for chunks without one (sorted last), with identical contents de-duplicated. ([validated by `spec-summary@ace915fb`](libs/shared/src/work/spec-summary.test.ts#L9), [validated by `spec-summary@78204270`](libs/shared/src/work/spec-summary.test.ts#L18), [validated by `spec-summary@e0fa0276`](libs/shared/src/work/spec-summary.test.ts#L27), [validated by `spec-summary@a0daf4bc`](libs/shared/src/work/spec-summary.test.ts#L33), [validated by `spec-summary@d53dd886`](libs/shared/src/work/spec-summary.test.ts#L39), [validated by `spec-summary@bd27c757`](libs/shared/src/work/spec-summary.test.ts#L46), [validated by `spec-summary@6e6cb681`](libs/shared/src/work/spec-summary.test.ts#L52), [validated by `spec-summary@881452c8`](libs/shared/src/work/spec-summary.test.ts#L60), [validated by `spec-summary@bb6a4136`](libs/shared/src/work/spec-summary.test.ts#L64), [validated by `spec-summary@22a7ee18`](libs/shared/src/work/spec-summary.test.ts#L73), [validated by `spec-summary@0263439f`](libs/shared/src/work/spec-summary.test.ts#L82), [validated by `spec-summary@8478d932`](libs/shared/src/work/spec-summary.test.ts#L91), [validated by `spec-summary@ed5c9a0f`](libs/shared/src/work/spec-summary.test.ts#L101), [validated by `spec-summary@4eb40d06`](libs/shared/src/work/spec-summary.test.ts#L110))

15. `segmentStatements()` splits prose paragraphs into sentences and each list item into its own ordinal-stable statement — joining wrapped continuation lines, ending a continuation at a heading, table row, or code fence, dropping bare list markers, guarding against splitting on single-initial (`J. B.`) and `e.g.`/`i.e.` abbreviations or a lowercase next character, splitting after punctuation-only leading sentences, excluding headings/fenced code/tables, tracking the enclosing heading per statement, keeping a trailing or own-line markdown-link parenthetical attached to its statement, and returning an empty array for content with no statements. ([validated by splits prose paragraphs into sentences @076fdc5e](libs/shared/src/domain/spec-segment.test.ts#L10), [`ss-continuations@f41d947d`](libs/shared/src/domain/spec-segment.test.ts#L37), [`ss-excludes@e64e329f`](libs/shared/src/domain/spec-segment.test.ts#L46), [`ss-abbrev@ee23cda7`](libs/shared/src/domain/spec-segment.test.ts#L77), [`ss-initials@d49884d3`](libs/shared/src/domain/spec-segment.test.ts#L87), [`ss-lowercase@e624dd41`](libs/shared/src/domain/spec-segment.test.ts#L96), [`ss-heading@17874556`](libs/shared/src/domain/spec-segment.test.ts#L102), [`ss-ordinals@fb4b4da5`](libs/shared/src/domain/spec-segment.test.ts#L124), [`ss-trailing-link@0492221b`](libs/shared/src/domain/spec-segment.test.ts#L134), [`ss-ownline-link@7840c39d`](libs/shared/src/domain/spec-segment.test.ts#L143), [`ss-empty@853b581d`](libs/shared/src/domain/spec-segment.test.ts#L156))

16. `buildIntroOrdinals()` marks statements under the document's first heading, or with no enclosing heading at all, as intro; `classifyByHeuristic()` returns those intro ordinals untestable as `intro`, marks narrative doc sections (alternatives / research / personas / out-of-scope), the standard narrative headings (Problem Statement → background, Vision, Clarifications, Open Questions, Limitations, Rationale), and `Decision:`-prefixed or bare `See ADR-NNN` cross-reference statements untestable, and leaves everything else — unrecognised headings, a statement with no enclosing heading, a real functional requirement — testable. It also marks untestable a bullet under a heading that is just Sources or References (`background`); every sentence of a paragraph that opens with spec-kit's bold Why this priority (`rationale`) or Independent Test (`background`) label, which `segmentStatements()` hands each of those sentences as its `leadIn`; and a statement that is only a bold label, such as `**Acceptance Scenarios:**` (`background`), unless it ends a sentence or names an RFC 2119 keyword: those lines head or explain requirements, and counting them testable had the planner plan them. ([validated by marks statements under the document's first heading as intro @cdd02ab9](libs/shared/src/domain/spec-segment.test.ts#L163), [`cbh-no-heading@e88212ac`](libs/shared/src/domain/spec-segment.test.ts#L181), [`cbh-intro@d383e76a`](libs/shared/src/domain/spec-segment.test.ts#L200), [`cbh-background@3bd3f6cc`](libs/shared/src/domain/spec-segment.test.ts#L211), [`cbh-vision@2065aa3f`](libs/shared/src/domain/spec-segment.test.ts#L220), [`cbh-clarification@e035eb7f`](libs/shared/src/domain/spec-segment.test.ts#L226), [`cbh-open-question@63646843`](libs/shared/src/domain/spec-segment.test.ts#L232), [`cbh-limitation@e6387c31`](libs/shared/src/domain/spec-segment.test.ts#L238), [`cbh-rationale@f4583f4a`](libs/shared/src/domain/spec-segment.test.ts#L246), [`cbh-unrecognised@81b4a4f1`](libs/shared/src/domain/spec-segment.test.ts#L252), [`cbh-decision@f3f4278b`](libs/shared/src/domain/spec-segment.test.ts#L270), [`cbh-xref@c12fdb62`](libs/shared/src/domain/spec-segment.test.ts#L285), [`cbh-narrative@3d3e099d`](libs/shared/src/domain/spec-segment.test.ts#L297), [`cbh-functional@da109ab0`](libs/shared/src/domain/spec-segment.test.ts#L312), [validated by stamps both sentences of a paragraph opened by a bold Why this priority label with the label, without its colon, and a plain paragraph with none @b059730e](libs/shared/src/domain/spec-segment.test.ts#L400), [validated by marks both sentences of a Why this priority paragraph untestable as rationale, the second one too @ea773788](libs/shared/src/domain/spec-segment.test.ts#L417), [validated by marks both sentences of an Independent Test paragraph untestable @3b16e563](libs/shared/src/domain/spec-segment.test.ts#L424), [validated by marks a line that is only a bold label, Acceptance Scenarios or Crash guard, untestable, and keeps the scenario under it testable @f4372d40](libs/shared/src/domain/spec-segment.test.ts#L431), [validated by keeps a bold line that ends a sentence or names MUST testable, and a paragraph led by a bold FR-001 @16bbff8b](libs/shared/src/domain/spec-segment.test.ts#L439), [validated by marks a bullet under a heading that is just Sources untestable as background, and keeps one under Data Sources testable @155f158e](libs/shared/src/domain/spec-segment.test.ts#L447), [validated by marks a bullet under References or Sources and References untestable, and keeps one under Source Files testable @9d68ce69](libs/shared/src/domain/spec-segment.test.ts#L467))

17. `parseCodeLinksInStatement()` extracts the trailing parenthetical as a non-test code reference, excluding markdown doc links so an ADR ref is not a code link, and URLs so a plan block's link is not a code link either; `linksForStatements()` pairs each segmented statement with its parsed test links; `findMisplacedCoverageLinks()` flags a test-file coverage link buried in a non-trailing parenthetical while ignoring one correctly in the trailing paren, a non-trailing prose doc link, an intra-doc anchor, an absolute URL, a placeholder or `<owner>`-style template path, a mid-prose source-file reference, a link quoted inside an inline code span, and a prose bracket that would otherwise fuse with the trailing parenthetical's first link. ([validated by parses a single non-test code link into one code-link ref @3734415b](libs/shared/src/domain/spec-link-parser.test.ts#L142), [`pcl-excl-doc@4c34096c`](libs/shared/src/domain/spec-link-parser.test.ts#L152), [`pcl-url@6c7800c6`](libs/shared/src/domain/spec-link-parser.test.ts#L160), [`pcl-other-lang@310b7cc1`](libs/shared/src/domain/spec-link-parser.test.ts#L170), [`lfs-pairs@425d8fdb`](libs/shared/src/domain/spec-link-parser.test.ts#L182), [`fmcl-buried@f860201a`](libs/shared/src/domain/spec-link-parser.test.ts#L215), [`fmcl-trailing-ok@09c37125`](libs/shared/src/domain/spec-link-parser.test.ts#L230), [`fmcl-prose-doc@2c07626b`](libs/shared/src/domain/spec-link-parser.test.ts#L238), [`fmcl-anchor@cf491a36`](libs/shared/src/domain/spec-link-parser.test.ts#L246), [`fmcl-url@f0c41fe5`](libs/shared/src/domain/spec-link-parser.test.ts#L254), [`fmcl-placeholder@374772af`](libs/shared/src/domain/spec-link-parser.test.ts#L262), [`fmcl-source-ref@8806d519`](libs/shared/src/domain/spec-link-parser.test.ts#L270), [`fmcl-code-span@df90c27f`](libs/shared/src/domain/spec-link-parser.test.ts#L278), [`fmcl-bracket-fusion@0b2bc054`](libs/shared/src/domain/spec-link-parser.test.ts#L286))

18. `parseSpecStatus()` reads the `| Status |` table row (case-insensitive label, bold or plain, ignoring a non-table line that merely contains the word Status), keeping the leading word as label and bucketing it into `shipped` (Shipped / Complete / Implemented), `draft`, `in-progress` (In Progress / In review), `retired` (Retired / Removed / superseded), or `rejected` — dropping any trailing suffix and returning null for a missing row or unrecognised value; `matchesSpecStatusFilter()` matches everything (including unparsed specs) on `all` and only the selected bucket otherwise. ([validated by `spec-status`](apps/web-ui/src/lib/spec-status.test.ts), [`spec-status-parity-spec@9d97b3f5`](apps/web-ui/src/lib/spec-status.parity.test.ts#L33), [`spec-status-parity-adr@6441bb15`](apps/web-ui/src/lib/spec-status.parity.test.ts#L39), [`spec-status-parity-null@d97daa88`](apps/web-ui/src/lib/spec-status.parity.test.ts#L45))

19. The per-repo `SpecListView` counts folder statuses into chips that filter the cards when clicked, and the global doc browsers (`/specs` and `/adrs`, one shared `GlobalDocsView`) group docs by repo — linking each path to its per-repo detail page, spec or adr by `kind` — count statuses into chips that filter the list (the adr kind swapping in the frontmatter legend), narrow to a typed search text, and show the page's empty-state and no-match hints. ([validated by `SpecListView@fe18a805`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L48), [`SpecListView@4e493204`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L53), [`GlobalDocsView@975f38d1`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L7), [`GlobalDocsView@cfd841ac`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L28), [`GlobalDocsView@dbba7e2e`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L39), [`GlobalDocsView@d0be9de3`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L68), [`GlobalDocsView@52d3b76c`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L89), [`GlobalDocsView@b8fb6506`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L109), [`GlobalDocsView@6656e707`](apps/web-ui/src/components/GlobalDocsView.test.tsx#L128))

20. `SpecCard` renders its title and a Details link pointing at the given `detailsHref`, hides the coverage note when `testable` is 0, renders one file chip per file instead of a Details link when `files` is given, and renders the status pill label when `status` is given; `SpecDocument` renders one framed `data-doc-section` card per markdown section. ([validated by `SpecCard@84ac06cf`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L7), [`SpecCard@7c93bf98`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L36), [`SpecCard@eef04743`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L47), [`SpecCard@19fd6f6b`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx#L67), [`SpecDocument@8a0b6f65`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/[...path]/SpecDocument.test.tsx#L8))

21. `resolveHref()` rewrites a repo-relative path (stripping a leading `./`) to a `github.com/<owner>/<repo>/blob/<branch>/<path>` URL marked external on the given branch, leaves an absolute https URL external, and leaves an in-page `#anchor`, a relative path when the repo is not `owner/name`, and an empty href unchanged and not external; `SpecDetails` renders an inline test link as that absolute GitHub URL opening in a new tab (`target=_blank`, `rel=noopener noreferrer`), rewrites a non-test ADR author link the same way without the test-link cue, and leaves links relative (no new tab) when the repo is not `owner/name`. ([validated by `resolveHref@78921dac`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L380), [`resolveHref@09efcb8a`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L389), [`resolveHref@7d721ede`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L395), [`resolveHref@00fa9083`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L401), [`resolveHref@7680ee07`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L410), [`resolveHref@a8373983`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L417), [`resolveHref@54d1431c`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L424), [`SpecDetails@015dc51d`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L149), [`SpecDetails@6963c10e`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L181), [`SpecDetails@031b0b34`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L204), [`SpecDetails@5ce2c171`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L246))

22. `SpecDetails` marks a drifted statement's `<mark>` with `data-drifted="true"` and surfaces a drift notice in its hover popover, keeps the statement highlight stable across re-renders, wraps statements spanning inline bold, inline code, or a code span containing literal link/emphasis syntax with `stmt-tested`, and renders none of the legacy DB-driven `tests[]` list, `TestLink` prop, or list-only/legacy badges. ([validated by `SpecDetails@dd637cf2`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L78), [`SpecDetails@22c63e7b`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L267), [`SpecDetails@94d3e373`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L286), [`SpecDetails@f9b12273`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L298), [`SpecDetails@41770a22`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L318), [`SpecDetails@17c1da80`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L338), [`SpecDetails@a4eb7cd8`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L359), [`SpecDetails@04b9c1d3`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L478), [`SpecDetails@53664374`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L499))
23. Enforcement support in `@re-cinq/lore-shared`: `segmentStatements()` stamps each statement's 1-based source start line (the paragraph line for a sentence, the marker line for a list item, shared across sentences split from one paragraph) so the `require-statement-links` rule can report at the offending line; `parseDocStatus()` normalizes a spec's `| Status |` table row or an ADR's frontmatter `status:` (read only inside the `---` block) into one of five buckets — `draft`, `in-progress` (ADR `proposed`), `shipped` (folding Shipped / Implemented / Complete / Accepted / Done / Live and ADR `accepted`, stripping bold markers and trailing prose), `retired` (Retired / Removed / ADR `superseded` — shipped then terminated), `rejected` (never accepted), or `null` for an absent/unrecognised value; and `statusTier()` maps those to the report gate — `rejected` and `retired` skip, every other status (shipped / draft / in-progress / unknown) warns. ([validated by stamps each statement with its 1-based source start line @325b926f](libs/shared/src/domain/spec-segment.test.ts#L327), [`spec-status`](libs/shared/src/domain/spec-status.test.ts))


24. `GlobalDocsView` is a client component rendered by the `/specs` and `/adrs` server components, so those pages pass it only serializable props — a function prop fails the render at runtime, with the message redacted in production builds. ([validated by passes no function props across the server boundary from /specs @8816a8a3](apps/web-ui/src/app/global-docs-boundary.test.tsx#L40), [`adrs boundary` @0cb21b20](apps/web-ui/src/app/global-docs-boundary.test.tsx#L46))

25. The global and per-repo doc list endpoints return each document's lifecycle pill (`docStatusPill`) alongside the list, so a list page resolves statuses in its one API call instead of one source fetch per document — a fan-out that put a single `/specs` render at 114 requests against the API's shared 200/min `default` bucket. ([validated by spec-status.test.ts:320 @09707c37](libs/shared/src/domain/spec-status.test.ts#L320))

26. `SpecDetails` sanitizes the spec markdown after raw-HTML parsing and before statement highlighting: an injected `<script>` is stripped while statement `<mark>` wrapping still applies, an `onerror` attribute is removed from raw `<img>` HTML, a `javascript:` href is stripped from a raw anchor, and an injected `<svg onload>` is dropped. ([validated by `SpecDetails.test.tsx@fecd059c`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L433), [`SpecDetails.test.tsx@eedfe903`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L451), [`SpecDetails.test.tsx@4a10ca35`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L461), [`SpecDetails.test.tsx@5dd63033`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L470))

27. `testLinksOfDoc()` lists every test link a spec or ADR carries with the line of the statement that carries it, resolves a `../` href against the doc's folder, marks a link outside its statement's trailing parenthetical as misplaced, and leaves out URLs and the `path/to/test.ts` placeholder. ([validated by returns the trailing link to apps/x/a.test.ts line 12 with its statement's line 3 @52895660](libs/shared/src/domain/spec-link-parser.test.ts#L296), [validated by marks a test link in the middle of a statement as misplaced @2029b3ec](libs/shared/src/domain/spec-link-parser.test.ts#L315), [validated by resolves ../../apps/x/a.test.ts against the folder of specs/a/spec.md @82f02716](libs/shared/src/domain/spec-link-parser.test.ts#L324), [validated by returns nothing for a source file, a URL and the path/to/test.ts placeholder @b82017a8](libs/shared/src/domain/spec-link-parser.test.ts#L333))

28. `POST /api/spec-links/parse` (read scope) takes the content of specs and ADRs and answers their test links in document order, so a check written in any language judges the links the one parser finds; a body without `docs` is a 400. ([validated by answers the test link of specs/a/spec.md with its statement line and target @5450da0d](apps/lore-api/src/transport/routes/spec-links/spec-links-parse.test.ts#L26), [validated by answers the links of adrs/ADR-001.md after those of specs/a/spec.md @612124e8](apps/lore-api/src/transport/routes/spec-links/spec-links-parse.test.ts#L52), [validated by answers no links for a doc that carries none @8dc70a63](apps/lore-api/src/transport/routes/spec-links/spec-links-parse.test.ts#L72), [validated by refuses a body without docs as a 400 @6693633e](apps/lore-api/src/transport/routes/spec-links/spec-links-parse.test.ts#L80))

29. `lore-code-trace links` fails with one `::error file=…,line=…::` annotation per broken link: a linked file the checkout does not track, a line past the end of the file, or a misplaced link. The `spec-links` job's verdict is that exit status and nothing else — the step does not swallow it behind a shell `||`, so the only thing that lets a broken link through is the binary itself ruling the failure Lore's. ([validated by TestRunLinksFailsWithAnAnnotationForALinkPastTheEndOfItsFile @f47da32b](apps/lore-code-trace/links_run_test.go#L57), [validated by TestBrokenLinksReportsAMissingFile @f35232d5](apps/lore-code-trace/links_test.go#L72), [validated by TestBrokenLinksReportsALinePastTheEndOfTheFile @4fd0341f](apps/lore-code-trace/links_test.go#L83), [validated by TestBrokenLinksReportsAMisplacedLink @e6861b59](apps/lore-code-trace/links_test.go#L94), [validated by TestAnnotationNamesTheDocAndLine @037ceb8c](apps/lore-code-trace/links_test.go#L138), [validated by TestAnnotationOmitsTheLineWhenTheStatementHasNone @8914513b](apps/lore-code-trace/links_test.go#L147))

30. A link inside its file, and a link with no line, pass. ([validated by TestRunLinksPassesWhenEveryLinkHolds @604fcf20](apps/lore-code-trace/links_run_test.go#L75), [validated by TestBrokenLinksAcceptsALinkInsideTheFileAndALinkWithNoLine @01fa22ed](apps/lore-code-trace/links_test.go#L104))

31. Against a base branch (`--base`, else `GITHUB_BASE_REF`) the check parses only the docs the change touched and the docs whose text names a file it touched, matched by file name so a `../` link relative to the doc is not missed. ([validated by TestRunLinksAgainstABaseSendsOnlyTheDocsTheChangeCouldBreak @27818e03](apps/lore-code-trace/links_run_test.go#L90), [validated by TestDocsToCheckKeepsChangedDocsAndDocsNamingAChangedFile @6075ce08](apps/lore-code-trace/links_test.go#L22), [validated by TestCheckLinksSendsNothingWhenNoDocIsInScope @0b601cd7](apps/lore-code-trace/links_test.go#L189), [validated by TestDocsToCheckKeepsADocThatNamesATouchedFileByARelativePath @093b2a50](apps/lore-code-trace/links_test.go#L37))

32. A scoped check reports every broken link of a doc the change touched and, in any other doc, only the links pointing at a file the change touched, so rot that predates the change does not fail it. ([validated by TestRunLinksAgainstABaseReportsASpecWhoseTestFileTheChangeDeleted @ffb1fbbc](apps/lore-code-trace/links_run_test.go#L107), [validated by TestBrokenLinksLeavesAnUntouchedDocsOldRotOutOfAScopedCheck @cb7b1b56](apps/lore-code-trace/links_test.go#L117))

33. `--all`, or no known base, checks every link of every spec and ADR. ([validated by TestCheckLinksSendsEverySpecAndReturnsTheBrokenOnes @406564de](apps/lore-code-trace/links_test.go#L169), [validated by TestDocsToCheckKeepsEveryDocWhenTheScopeIsEverything @6c152551](apps/lore-code-trace/links_test.go#L54))

34. A base that cannot be found fails the check by name, and so does `--base` given no value. ([validated by TestRunLinksFailsWhenTheBaseCannotBeFound @1040d084](apps/lore-code-trace/links_run_test.go#L196), [validated by TestParseArgsRefusesBaseWithNoValue @6ce1d76a](apps/lore-code-trace/docs_run_test.go#L262))

35. The check is skipped with a `::warning::` and passes when lore-api does not answer or `LORE_API_URL` / `LORE_INGEST_TOKEN` is unset, so a Lore outage or a fork without secrets blocks no pull request; a 403 is lore-api failing to look the token up rather than a token too narrow for the route, so it is retried and then warned about like an outage, while a 401 fails the check. ([validated by TestRunLinksWarnsAndPassesWhenLoreIsUnreachable @5b8d4326](apps/lore-code-trace/links_run_test.go#L127), [validated by TestRunLinksWarnsAndPassesWithoutAToken @6ccb9045](apps/lore-code-trace/links_run_test.go#L141), [validated by TestRunLinksWarnsAndPassesWhenTheTokenKeepsBeingRefusedForScope](apps/lore-code-trace/links_run_test.go), [validated by TestRunLinksChecksTheLinksWhenA403GivesWayToAnAnswer](apps/lore-code-trace/links_run_test.go), [validated by TestRunLinksFailsWhenLoreRefusesTheToken @0472844e](apps/lore-code-trace/links_run_test.go#L184), [validated by TestCheckLinksReturnsTheParseFailure @c4027006](apps/lore-code-trace/links_test.go#L199))

36. A file's line count includes a last line that has no trailing newline. ([validated by TestCountLinesCountsATrailingLineWithoutNewline @34f1f99d](apps/lore-code-trace/links_test.go#L13))

## Limitations & Open Questions

1. **Backfill cost.** Existing specs across the org have ~zero markdown test links today. The first weekly backfill run will open one PR per spec with suggestions — potentially dozens of PRs at once. Mitigation: rate-limit the first run, or gate the backfill on a feature flag and ramp slowly. Document the burst. ([validated by staggers PR creation with an explicit limit across repositories on an initial burst @70a16c05](libs/shared/src/work/spec-upkeep/floor-spec-upkeep.acceptance.test.ts#L6))
2. **Multiple test links per statement.** Format A handles this via comma-separation inside one paren. The rehype detection wraps all of them; the popover lists all of them. Tested.
3. **Manually-added links may not match the cron's preferred format.** The validate pass tolerates any markdown link whose href passes `isTestFile()` — the parenthetical wrapper is the cron's emission style, not a requirement on the author. An author who writes `It [does the thing](src/x.test.ts#L<line>).` mid-statement also gets the green wrap.
4. **Link rot UX.** *(Superseded 2026-10-02.)* The retired validate pass posted PR comments or fell back to a `spec-link-rot` labelled issue (`F-validate-fallback`); broken links are now caught directly on the pull request that breaks them by the `spec-links` check (`specs/external-floor` FR16.6).
5. **No pass/fail status.** Out of scope (v2 limitation carries). Coverage-ingestion (deferred spec) could later feed run-status into the UI.
6. **Statement segmentation determinism.** The cron and UI must agree on what counts as a statement (so the backfill PR's inserted parenthetical lands on the right statement). `segmentStatements()` from shared is deterministic; this AC is verified by the existing shared test suite.
7. **Cleanup of v2 data.** Phase 4 drops the tables. If a downstream tool reads them (none known), the drop is destructive. Audit before applying.
8. **Local-coverage-linker is superseded.** The BYO-compute persist apparatus shipped in PR #483/#484 is removed by Phase 4. Authors who started using `/lore-link-coverage` (none yet, since it shipped today) lose that flow. The migration story: their committed links in the DB are dropped along with the tables; they should re-add as markdown in spec.md.
9. **Coverage-ingestion remains deferred.** Could later feed the backfill cron's judge with execution-trace evidence (raising suggestion precision); not v3 scope.
