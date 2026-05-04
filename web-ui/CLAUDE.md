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

### Detail page shows all content types

`/specs/[...path]/page.tsx` queries `WHERE file_path = $1` with **no**
`content_type` filter. If the same file path was ingested under multiple
content types (e.g. once as `spec` and once as `adrs`), all chunks appear.
This is intentional — the detail page is a generic chunk viewer for any
ingested path, not exclusively a spec viewer. The breadcrumb label "Context"
(rather than "Specifications") is a remnant of this original scope; it should
read "Specifications" to match the list page heading but has not been updated.

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
(`search_context`, `search_memory`) or `assemble_context` because those rely
on the `embedding` column. To make manually added specs searchable,
trigger a re-ingest via `POST /api/repos/{owner}/{repo}/ingest` or the
nightly ingest job.

### Detail page — rendering contract and implementation notes

`/specs/[...path]/page.tsx` is a Next.js **async Server Component** with
`export const dynamic = "force-dynamic"`. The `force-dynamic` directive is
required because `queryAllChunks` hits the live DB; without it Next.js would
statically cache the response at build time and serve stale chunks.

The query selects these fields from every team schema + `org_shared`:

```
id, file_path, content_type, content, team, repo, author, ingested_at, metadata
```

`metadata` is a JSONB column; `author` comes from the ingestion pipeline and
may be `null` for older rows or manually inserted chunks.

Rendering behaviour:
- If `chunks.length === 0` → "Not Found" empty state with the raw file path
  in the message. No 404 status is set (returns 200 with empty-state JSX).
- First chunk only: monospace `<h1>` showing the file path (16 px, `var(--font-mono)`).
- Each chunk: badge row (`content_type`, `team`, `repo`, `author`, `ingested_at`);
  `<pre>` content block; collapsible `<details>` for `metadata` (shown only
  when `metadata` is truthy).
- Chunks are separated by an `<hr>` except after the last one.
- When `chunks.length > 1`, a footer line reads "N chunks for this file path."

The `metadata` collapsible is the only place structured ingest metadata
(e.g. source URL, chunk index, token count) is surfaced in the UI. If a chunk
was ingested with no metadata the `<details>` element is suppressed entirely.

### Why the detail route was not removed

The original UX spec (specs/4-ux-repo-onboarding, Task T029) planned to
remove `/specs` and `/specs/[...path]` once content moved under
`/repos/[owner]/[repo]/specs`. That removal did not land because:

1. The per-repo specs page has no link to a detail view — removing the global
   detail route would leave no way to read full chunk content from the UI.
2. The global list (`/specs`) serves a cross-repo discovery use case that the
   per-repo page cannot fulfill.

Both routes remain. The per-repo page is the primary path for repo-scoped
work; the global routes serve cross-org discovery. No further removal is
planned unless a linked detail view is added to the per-repo page.

### Sorting and deduplication

Both the global list and the detail page sort by `ingested_at DESC`. Re-ingesting
a file creates a new chunk row — it does **not** upsert. The detail page
therefore shows multiple chunks for the same path if the file was ingested
more than once; the most recent appears first with a horizontal rule separator
between entries. There is no deduplication or "latest only" toggle.
