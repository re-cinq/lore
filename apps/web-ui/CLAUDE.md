# web-ui

Next.js 14 App Router frontend for the Lore platform.

## App structure

```
src/app/
  repos/[owner]/[repo]/   — repo-centric view (overview, tasks, specs, context, settings)
  pipeline/               — global pipeline task list and detail
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
  context/                — (legacy route, redirects)
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

The DB user is `lore_ui` (read-only on team schemas). Server Actions that
write (e.g. "Add Spec") use the same pool — make sure `lore_ui` has INSERT
on the relevant tables if adding new write paths.

## Specs viewer — design decisions and known gotchas

Three routes make up the specs viewer:

| Route | File | Scope |
|---|---|---|
| `/specs` | `src/app/specs/page.tsx` | Global list, all repos, `content_type = 'spec'` only |
| `/specs/[...path]` | `src/app/specs/[...path]/page.tsx` | Detail view for one file path, **all content types** |
| `/repos/[owner]/[repo]/specs` | `src/app/repos/[owner]/[repo]/specs/page.tsx` | Per-repo list + manual add form |

### URL encoding contract (catch-all route)

The global list links to the detail page using `encodeURIComponent` on the
**full** `file_path` value (which typically contains `/`):

```tsx
href={`/specs/${encodeURIComponent(s.file_path)}`}
// e.g. /specs/specs%2F1-lore-platform%2Fspec.md
```

`encodeURIComponent` encodes `/` as `%2F`. Next.js does **not** split on
`%2F` when resolving catch-all segments, so `params.path` is always a
**single-element array** `['specs%2F1-lore-platform%2Fspec.md']` regardless
of how many slashes the original path contains. The detail page decodes it:

```tsx
const filePath = path.map(decodeURIComponent).join('/');
// → 'specs/1-lore-platform/spec.md'
```

Do not change the list page's `encodeURIComponent` to a bare path template
literal — that would cause Next.js to split on `/` and produce multiple
segments, breaking the decode logic.

### Detail page renders specs richly (spec-only)

`/specs/[...path]/page.tsx` queries `WHERE file_path = $1 AND content_type
= 'spec'`, matching the list page — source code (`content_type = 'code'`),
ADRs, docs, and tasks are **not** shown; a non-spec path returns "Not Found".
It then reuses the **same render pipeline as the per-repo detail page**:
`reassembleSpec` → `deriveCoverageFromMarkdown` → `CoverageBar` +
`SpecDetails` (imported from `app/repos/[owner]/[repo]/specs/SpecDetails`),
so the global view shows the markdown with the coverage bar and
statement-level coloring, not a raw `<pre>` dump. Because the global view
spans every team schema, chunks are grouped by `repo` and each group
reassembles/scores independently (normally one group); each carries a
"view in repo →" link to the canonical per-repo page. Breadcrumb reads
"Specifications".

### Repo-specific specs page does not link to the detail view

`/repos/[owner]/[repo]/specs/page.tsx` renders spec cards with a 400-char
preview but the `<h3>` heading is plain text, not a link. There is no
navigation path from the repo-specific specs list to the global detail page.
If you add a link, use:

```tsx
<Link href={`/specs/${encodeURIComponent(s.file_path)}`}>{s.file_path}</Link>
```

### Manually added specs have no embeddings

The "Add Spec" server action in the repo specs page does a raw
`INSERT INTO ${schema}.chunks (...)`. It does **not** call the embedding
pipeline. Rows inserted this way will appear in the web-ui list and detail
views (exact DB lookup) but will **not** be returned by semantic search
(`lore_search_context`, `lore_search_memory`) or `lore_assemble_context` because those rely
on the `embedding` column. To make manually added specs searchable,
trigger a re-ingest via `POST /api/repos/{owner}/{repo}/ingest` or the
nightly ingest job.

### Sorting and deduplication

Both the global list and the detail page sort by `ingested_at DESC`. Re-ingesting
a file creates a new chunk row — it does **not** upsert. The detail page
therefore shows multiple chunks for the same path if the file was ingested
more than once; the most recent appears first with a horizontal rule separator
between entries. There is no deduplication or "latest only" toggle.
