# web-ui

Next.js 15 App Router frontend for the Lore platform.

## App structure

```
src/app/
  repos/[owner]/[repo]/   — repo-centric view (overview, tasks, specs, context, settings)
  assembly-lines/         — run-keyed list (pipeline.assembly_lines) + [id] resolver:
                            a run id renders run detail (header + node timeline),
                            a task id redirects to /tasks/[id]
  tasks/[id]/             — task detail (facts, Timeline, TaskLogs, PR status,
                            revision/cancel/run-now); api/tasks/[id]/* backs it
  specs/                  — global cross-repo spec viewer
  gaps/                   — gap detection (zero-result searches + agent findings)
  search/                 — semantic search across context
  episodes/               — episode viewer
  graph/                  — knowledge graph explorer
  analytics/              — token usage / cost analytics
  audit/                  — audit log viewer
  agents/                 — agent list
  pools/                  — shared memory pools
  onboard/                — self-service repo onboarding
  context/                — global cross-repo context/chunk browser (not in sidebar nav)
  settings/               — org-wide settings
src/lib/
  db.ts                   — PostgreSQL pool, queryAllChunks, schema helpers
  github.ts               — GitHub App client for PR status fetching
```

## Database access

All DB access goes through `src/lib/db.ts`. Key helpers:

- `query<T>` / `queryOne<T>` — single-schema queries against `lore.*` tables
- `queryAllChunks<T>` — UNION ALL across every team schema + `org_shared`.
  Receives a `selectFn(schema, paramOffset)` that returns `{sql, params}`.
  `paramOffset` starts at `allParams.length + 1` so each schema branch gets
  a unique `$N` placeholder. The same logical parameter (e.g. a file path)
  appears once per schema in `allParams` — this is correct but looks
  redundant when reading the call sites.

The DB user defaults to `lore_ui` (read-only on team schemas; overridable via
`LORE_DB_USER`). Any Server Action that writes uses the same pool — make sure
`lore_ui` has the required grants on the relevant tables if adding new write
paths.

## Specs viewer — design decisions and known gotchas

The specs viewer reads from the **spec-traceability graph** (via
`src/lib/trace-api`: `fetchAllSpecs`, `fetchSpecSummaries`, `fetchTraceSource`,
`fetchTraceDocument`), not from the `chunks` table. Specs are projected into
the graph automatically by CI on push to `main`, so there is no manual "add
spec" write path and no per-chunk embedding/dedup handling in these pages.

Three routes make up the specs viewer:

| Route | File | Scope |
|---|---|---|
| `/specs` | `src/app/specs/page.tsx` | Global list of every spec in the graph across all repos (`GlobalDocsView`) |
| `/specs/[...path]` | `src/app/specs/[...path]/page.tsx` | Detail for one file path — renders one `SpecDocument` per repo that holds that path |
| `/repos/[owner]/[repo]/specs` | `src/app/repos/[owner]/[repo]/specs/page.tsx` | Per-repo list (`SpecListView`); each entry links to the per-repo detail page |

### Linking between the list and detail pages

The global list (`GlobalDocsView`) links each entry to the **per-repo** detail
page — `/repos/{repo}/specs/{...}` for specs, `/repos/{repo}/adrs/{...}` for
ADRs — not to `/specs/[...path]`. The per-repo list (`SpecListView`) links each
spec to `/repos/{owner}/{repo}/specs/{...}` as well. The `/specs/[...path]`
catch-all route still exists (reachable by direct URL) and carries a
"view in repo →" link back to the canonical per-repo page for each repo that
holds the path.

### URL encoding contract (catch-all routes)

All of these links encode the **full** file path with `encodeURIComponent`
(the path typically contains `/`):

```tsx
href={`/repos/${repo}/specs/${encodeURIComponent(filePath)}`}
// e.g. /repos/re-cinq/lore/specs/specs%2F1-lore-platform%2Fspec.md
```

`encodeURIComponent` encodes `/` as `%2F`. Next.js does **not** split on
`%2F` when resolving catch-all segments, so `params.path` is always a
**single-element array** regardless of how many slashes the original path
contains. The detail page decodes it:

```tsx
const filePath = path.map(decodeURIComponent).join('/');
// → 'specs/1-lore-platform/spec.md'
```

Do not change these links to a bare path template literal — that would cause
Next.js to split on `/` and produce multiple segments, breaking the decode
logic.

### How the detail pages render

Both `/specs/[...path]/page.tsx` and the per-repo detail page render through
the shared `SpecDocument` component
(`app/repos/[owner]/[repo]/specs/[...path]/SpecDocument`): the markdown source
comes from `fetchTraceSource`, and the statement-level overlay (coverage bar +
per-statement coloring) from `fetchTraceDocument`, so the view is rich markdown
rather than a raw `<pre>` dump. The global detail page spans every repo that
holds the path, filtering `fetchAllSpecs()` by `filePath` and rendering one
framed `SpecDocument` per repo (normally one). Its breadcrumb reads "Specs",
and a path with no graph data shows a "No graph data …" empty state rather
than a hard 404.
