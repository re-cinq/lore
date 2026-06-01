# Data Model: Spec → Test Coverage

## `{schema}.spec_test_links`

One row per confirmed (spec, test) link. Created in **every team schema**
(mirroring `chunks` isolation) by an ordered, idempotent migration under
`terraform/modules/gke-mcp/ui-helm/migrations/`.

```sql
CREATE TABLE IF NOT EXISTS {schema}.spec_test_links (
  id           BIGSERIAL PRIMARY KEY,
  repo         TEXT NOT NULL,
  spec_path    TEXT NOT NULL,          -- chunks.file_path of the spec
  test_file    TEXT NOT NULL,          -- chunks.file_path of the test
  test_name    TEXT NOT NULL,          -- normalized "describe > it" path
  test_line    INTEGER,                -- best-effort line for source deep-link
  symbol       TEXT,                   -- assertion symbol that linked it, if any
  match_kind   TEXT NOT NULL,          -- 'assertion' | 'directory' | 'embedding'
  rationale    TEXT NOT NULL,          -- LLM judge's reason for the link
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, spec_path, test_file, test_name)
);

CREATE INDEX IF NOT EXISTS spec_test_links_spec_idx
  ON {schema}.spec_test_links (repo, spec_path);

CREATE INDEX IF NOT EXISTS spec_test_links_test_idx
  ON {schema}.spec_test_links (repo, test_file);
```

### Column notes

| Column | Notes |
|--------|-------|
| `repo` | `owner/name`. Redundant with schema but kept for cross-schema `queryAllChunks`-style scans and analytics. |
| `spec_path` | Joins to `{schema}.chunks.file_path` where `content_type = 'spec'`. A spec split into multiple chunks shares one `spec_path`. |
| `test_file` | Joins to `{schema}.chunks.file_path` where `content_type = 'code'` and `isTestFile(file_path)`. |
| `test_name` | Normalized `describe > it` join (lowercased, whitespace-collapsed). Stable key for a single test case. |
| `test_line` | From `chunks.metadata->>'start_line'` when AST chunking captured it; nullable. |
| `symbol` | The assertion symbol that triggered an `assertion`-kind link; null for `directory`/`embedding` links. |
| `match_kind` | Which pre-filter surfaced the candidate. Useful for tuning the matcher and for analytics on link provenance. |
| `rationale` | Non-empty by constraint of the writer (the LLM judge always returns a reason). Shown in the details view. |
| `linked_at` | Last time the linker confirmed this row. The linker upserts on conflict and prunes rows not confirmed in the latest run. |

### Lifecycle

- **Write**: `spec-test-linker` job upserts confirmed links
  (`ON CONFLICT (repo, spec_path, test_file, test_name) DO UPDATE`).
- **Prune**: after processing a spec, delete that spec's rows whose
  `linked_at` predates the current run — drops links no longer confirmed.
- **Read**: the `/api/repos/:owner/:repo/spec-coverage` handler and the
  web-ui page read by `(repo, spec_path)`.

## Coverage API payload

`GET /api/repos/:owner/:repo/spec-coverage`

```jsonc
[
  {
    "spec_path": "specs/local-task-runner/spec.md",
    "title": "Local Task Runner",            // parseSpecTitle()
    "summary": "A local task runner that ...", // extractSummary()
    "test_count": 12,
    "tests": [
      {
        "name": "local-runner › claims pending task before GKE",
        "file_path": "mcp-server/src/local-runner.test.ts",
        "line": 88,
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
- `url` is composed from the repo's `html_url` + default branch + `file_path`
  + `#L{line}` (line omitted when null).
- Specs with no links still appear with `test_count: 0` and `tests: []`
  so the page can render the gap state.

## Relationship to existing tables

- **`{schema}.chunks`** — source of both specs (`content_type='spec'`) and
  tests (`content_type='code'` filtered by `isTestFile`). `spec_test_links`
  references these by `file_path`; no FK (chunks churn on re-ingest).
- **`pipeline.tasks`** — unchanged. A future enhancement could file a
  `gap-fill` task for zero-coverage specs, exactly as `spec-drift` does for
  code divergence.
