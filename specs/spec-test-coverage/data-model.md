# Data Model: Spec → Test Coverage

A spec is segmented into **statements** (prose sentences + list items). Each
statement is classified `testable` or `untestable`, and each test is linked to
the single statement it most strongly validates. Three tables per team schema
(mirroring `chunks` isolation), all created by ordered, idempotent migrations
under `terraform/modules/gke-mcp/ui-helm/migrations/`:

- `spec_statements` — every segmented statement + its testable/untestable class.
- `spec_test_links` — one row per confirmed (statement, test) link.
- `spec_coverage_runs` — per-spec content hash for the change-detection gate.

## `{schema}.spec_test_links`

One row per confirmed (statement, test) link. The `UNIQUE (repo, spec_path,
test_file, test_name)` constraint enforces **one row per test per spec**, so a
test that validates several statements keeps only its single best match
(highest `match_score`).

```sql
CREATE TABLE IF NOT EXISTS {schema}.spec_test_links (
  id                BIGSERIAL PRIMARY KEY,
  repo              TEXT NOT NULL,
  spec_path         TEXT NOT NULL,          -- chunks.file_path of the spec
  test_file         TEXT NOT NULL,          -- chunks.file_path of the test
  test_name         TEXT NOT NULL,          -- normalized "describe > it" path
  test_line         INTEGER,                -- best-effort line for source deep-link
  statement_ordinal INTEGER,                -- segmentation index → spec_statements.ordinal
  statement_text    TEXT,                   -- the exact statement validated (denormalized for render)
  match_score       REAL,                   -- judge confidence; drives best-match-per-test
  symbol            TEXT,                   -- assertion symbol that linked it, if any
  match_kind        TEXT NOT NULL,          -- 'assertion' | 'directory' | 'embedding'
  rationale         TEXT NOT NULL,          -- LLM judge's reason for the link
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, spec_path, test_file, test_name)
);

CREATE INDEX IF NOT EXISTS spec_test_links_spec_idx
  ON {schema}.spec_test_links (repo, spec_path);

CREATE INDEX IF NOT EXISTS spec_test_links_test_idx
  ON {schema}.spec_test_links (repo, test_file);

CREATE INDEX IF NOT EXISTS spec_test_links_stmt_idx
  ON {schema}.spec_test_links (repo, spec_path, statement_ordinal);
```

The three statement columns (`statement_ordinal`, `statement_text`,
`match_score`) are **nullable and additive** — delivered by a separate
migration (`ADD COLUMN IF NOT EXISTS`) so pre-existing whole-spec link rows
remain valid; the linker backfills them on its next run for a changed spec.

## `{schema}.spec_statements`

One row per segmented statement per spec — the source of truth for the
covered / uncovered / untestable state of **every** statement, including those
with no link (so the coverage bar and the "untestable" flag can be computed
without re-segmenting at render time).

```sql
CREATE TABLE IF NOT EXISTS {schema}.spec_statements (
  id            BIGSERIAL PRIMARY KEY,
  repo          TEXT NOT NULL,
  spec_path     TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,       -- deterministic segmentation index
  text          TEXT NOT NULL,          -- the statement as segmented from the spec
  kind          TEXT NOT NULL,          -- 'sentence' | 'list-item'
  testability   TEXT NOT NULL,          -- 'testable' | 'untestable'
  category      TEXT,                   -- untestable bucket: 'intro'|'vision'|'clarification'|'open-question'|'limitation'|'rationale'
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, spec_path, ordinal)
);

CREATE INDEX IF NOT EXISTS spec_statements_spec_idx
  ON {schema}.spec_statements (repo, spec_path);
```

## `{schema}.spec_coverage_runs`

Change-detection marker for the freshness gate. The linker hashes the
deterministic `reassembleSpec()` output and skips any spec whose hash is
unchanged since its last successful run — so an edited spec re-links promptly
while unchanged specs cost zero LLM calls on every sweep.

```sql
CREATE TABLE IF NOT EXISTS {schema}.spec_coverage_runs (
  repo         TEXT NOT NULL,
  spec_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,           -- hash of reassembleSpec() output at last run
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, spec_path)
);
```

### Column notes

| Column | Notes |
|--------|-------|
| `repo` | `owner/name`. Redundant with schema but kept for cross-schema `queryAllChunks`-style scans and analytics. |
| `spec_path` | Joins to `{schema}.chunks.file_path` where `content_type = 'spec'`. A spec split into multiple chunks shares one `spec_path`. |
| `test_file` | Joins to `{schema}.chunks.file_path` where `content_type = 'code'` and `isTestFile(file_path)`. |
| `test_name` | Normalized `describe > it` join (lowercased, whitespace-collapsed). Stable key for a single test case. |
| `test_line` | From `chunks.metadata->>'start_line'` when AST chunking captured it; nullable. When null, the source link points at the file, not the line. |
| `statement_ordinal` | The validated statement's `spec_statements.ordinal`. Joins link → statement; null on legacy whole-spec rows until re-linked. |
| `statement_text` | The exact validated statement, denormalized so the renderer can anchor the inline highlight without a join. |
| `match_score` | Judge confidence 0–1. The linker keeps only the max-score row per `(test_file, test_name)`; rows below the threshold τ are not persisted. |
| `symbol` | The assertion symbol that triggered an `assertion`-kind link; null for `directory`/`embedding` links. |
| `match_kind` | Which pre-filter surfaced the candidate. Useful for tuning the matcher and for analytics on link provenance. |
| `rationale` | Non-empty by constraint of the writer (the LLM judge always returns a reason). Shown in the details view. |
| `linked_at` | Last time the linker confirmed this row. The linker upserts on conflict and prunes rows not confirmed in the latest run. |

### Lifecycle

- **Gate**: the linker hashes `reassembleSpec()` output and skips the spec
  entirely when its `spec_coverage_runs.content_hash` is unchanged.
- **Segment + classify**: changed specs are segmented into `spec_statements`
  and each statement is classified `testable`/`untestable`. Statements no
  longer present (ordinals dropped) are pruned.
- **Judge + write**: only `testable` statements are judged; confirmed links
  upsert into `spec_test_links` (`ON CONFLICT (repo, spec_path, test_file,
  test_name) DO UPDATE`), keeping the best statement per test.
- **Prune**: after processing a spec, delete that spec's link rows whose
  `linked_at` predates the current run — drops links no longer confirmed.
- **Read**: the `/api/repos/:owner/:repo/spec-coverage` handler and the
  web-ui page read by `(repo, spec_path)`, joining links to statements.

## Coverage API payload

`GET /api/repos/:owner/:repo/spec-coverage`

```jsonc
[
  {
    "spec_path": "specs/local-task-runner/spec.md",
    "title": "Local Task Runner",            // parseSpecTitle()
    "summary": "A local task runner that ...", // extractSummary()
    "coverage": {
      "testable": 8,     // green + red
      "covered": 6,      // green (≥1 linked test)
      "untestable": 4    // gray (fluff)
    },
    // every segmented statement, so the renderer paints all three states
    // and the CoverageBar without re-segmenting:
    "statements": [
      { "ordinal": 0, "text": "A local task runner that runs ...", "kind": "sentence", "testability": "untestable", "category": "intro" },
      { "ordinal": 14, "text": "claims a pending task before GKE picks it up", "kind": "list-item", "testability": "testable", "category": null }
    ],
    "tests": [
      {
        "name": "local-runner › claims pending task before GKE",
        "file_path": "mcp-server/src/local-runner.test.ts",
        "line": 88,
        "statement_ordinal": 14,
        "match_score": 0.82,
        "symbol": "claimNextTask",
        "match_kind": "assertion",
        "rationale": "exercises the SKIP LOCKED claim query",
        "url": "https://github.com/re-cinq/lore/blob/main/mcp-server/src/local-runner.test.ts#L88"
      }
    ]
  }
]
```

- `title` / `summary` are derived server-side from the reassembled spec
  content via the pure helpers in `web-ui/src/lib/spec-summary.ts`.
- `coverage` drives the `CoverageBar`: segment widths are over
  `testable + untestable` (all statements); the headline KPI is
  `covered / testable`.
- A test's `statement_ordinal` joins it to a statement; multiple tests may
  share one ordinal (a statement covered by several tests).
- `url` is composed from the repo's `html_url` + default branch + `file_path`
  + `#L{line}` (line omitted when null).
- Specs with no links still appear with `covered: 0` and `tests: []`
  so the page can render the gap state.

## Relationship to existing tables

- **`{schema}.chunks`** — source of both specs (`content_type='spec'`) and
  tests (`content_type='code'` filtered by `isTestFile`). `spec_statements`
  and `spec_test_links` reference these by `file_path`; no FK (chunks churn on
  re-ingest).
- **`pipeline.tasks`** — unchanged. The per-statement `spec_statements` table
  makes a future `gap-fill` task for the `testable` + uncovered (red)
  statements a trivial follow-up, exactly as `spec-drift` does for code
  divergence.
