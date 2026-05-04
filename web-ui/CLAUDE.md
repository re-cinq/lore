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

### Sorting and deduplication

Both the global list and the detail page sort by `ingested_at DESC`. Re-ingesting
a file creates a new chunk row — it does **not** upsert. The detail page
therefore shows multiple chunks for the same path if the file was ingested
more than once; the most recent appears first with a horizontal rule separator
between entries. There is no deduplication or "latest only" toggle.

### Global `/specs` route is not in the sidebar

`SidebarNav.tsx` does not include `/specs`. The global list is reachable only
via the repo specs page breadcrumb, direct URL, or the detail page back-link.
This was an intentional omission during the UX redesign (spec 4-ux-repo-onboarding
FR-3.8 listed "global search, audit, and shared pools" as top-level nav items
but did not name the specs list). Adding `/specs` to the sidebar is safe — add
it to the `links` array in `SidebarNav.tsx` between Analytics and Search.

### `repo` column stores the full `owner/repo` name

The `chunks.repo` column holds the full repository name (e.g., `re-cinq/lore`),
not just the repo slug. This affects two places in `specs/page.tsx`:

- **Filter buttons** compare `repo === r.repo` where both sides are full names.
  The URL query param is also the full name (`?repo=re-cinq/lore`).
- **Repo link** uses `href={`/repos/${s.repo}`}` which expands to
  `/repos/re-cinq/lore` — Next.js correctly matches this against the
  `[owner]/[repo]` route segments.

Do not change these to slug-only without updating the DB values and all other
call sites.

### Hard result caps — no pagination

The global list slices to 50 after merging all schema results. The per-repo
list uses `LIMIT 30` in SQL. There is no pagination UI on either page.
Both caps are applied after fetching from the DB (global) or in SQL (per-repo),
so adding a cursor or `offset` parameter is the correct extension path.

### Excerpt truncation appends `...` unconditionally

The global list renders `<pre>{s.excerpt}...</pre>` where `excerpt` is a
200-char substring. The `...` is appended in JSX regardless of whether the
content is shorter than 200 chars, producing `short content...` for small
specs. The per-repo list does the same at 400 chars.

### Original spec intended `.specify/` path filter — implementation uses content_type

The UX redesign spec (FR-3.6) described the specs tab as showing "`.specify/`
specs for this repo", implying a path-based filter. The implementation instead
filters on `content_type = 'spec'`, which captures any chunk ingested with
that type regardless of path. This is broader: an ingested `adrs/ADR-001.md`
would appear in the specs list if it were ingested with `content_type = 'spec'`.
The path-based intent was dropped when the ingestion pipeline adopted
content-type metadata. Do not re-introduce a path filter without also updating
the ingestion pipeline and the MCP `search_context` tool's content-type logic.
