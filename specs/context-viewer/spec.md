# Feature Specification: Context Viewer

| Field    | Value                 |
|----------|-----------------------|
| Feature  | Context Viewer        |
| Branch   | feat/context-tab-rich |
| Status   | Shipped               |
| Created  | 2026-06-04            |
| Owner    | Platform Engineering  |
| PR       | #516                  |

## Problem Statement

The Context tab — both the per-repo view (`/repos/:o/:r/context`) and the global
cross-repo view (`/context`) — rendered every ingested chunk as a truncated
`<pre>` dump (500 / 300 chars), with non-clickable file paths and no use of the
metadata the ingester already stores (`symbol_name`, `symbol_type`,
`start_line`/`end_line`, `section_title`). The content-type filter hardcoded a
non-existent `runbook` and omitted real types (`pull_request`, `rule`), and the
`search_tsv` GIN index was never queried. It was the last raw surface in the UI
after specs, overview, and search had all moved to rich rendering.

## Solution

Bring the Context tab to parity with the specs viewer. A single shared
`ChunkBody` renderer renders one chunk by `content_type`; list cards show a
clamped rich preview; each file links to a per-file detail page; the type
filter is data-driven; and a keyword search box queries the `search_tsv` index.
Code stays browsable but is one filter chip among the others, so the knowledge
view (doc / spec / adr) is the default landing.

### Architecture

```
list (RepoContextView / ContextView)
  → ContextFilters  (data-driven chips + search, client-nav with loading state)
       → SearchForm (client) + FilterChip (client, useLinkStatus spinner)
  → ContextCard     (badge, linked path, metadata header, first-block preview)
       → ChunkBody  (preview — first paragraph / first code block only)
  → LoadMore        (per-repo: pages in the rest from the context API route)
detail ([...path] route, per-repo + global)
  → ContextFileView (groups by repo in the global view)
       → ChunkBody  (full content)
```

- **`ChunkBody`** (`'use client'`) — markdown types (`doc`/`adr`/`spec`/
  `pull_request`/`rule`) via ReactMarkdown (`remark-gfm` + `rehype-raw`); `code`
  via `rehype-highlight` over a backtick-safe synthesized fence
  (`languageForPath` picks the language). Repo-relative links are rewritten to
  GitHub blob URLs that open in a new tab.
- **Pure helpers** carry the logic (and the tests): `lib/github-links.ts`
  (`resolveHref`, `blobUrl`), `lib/code-lang.ts` (`languageForPath`, `fenceFor`),
  `lib/content-types.ts` (`badgeClassForType`, `orderTypes`, `contextHref`),
  `lib/chunk-presenter.ts` (`chunkHeader`).
- **Search & filter** — `SearchForm` and `FilterChip` navigate client-side
  (`?q=` + `?type=`) so each surfaces a loading state while results load
  (`useTransition` on the search button; `useLinkStatus` spinner on the active
  chip). The backend filters on `search_tsv @@ websearch_to_tsquery('english',
  $q)` and ranks by `ts_rank`. The chip set is a `SELECT DISTINCT content_type`,
  unaffected by the active filter.
- **Preview cost** — list cards render only the chunk's lead block
  (`lib/preview-block.ts`: first paragraph for prose, keeping a leading heading;
  first lines for code), not the full 500-char body through ReactMarkdown for
  every row. The per-repo list loads `CONTEXT_PAGE_SIZE` (50) + 1 rows server-side
  (`pagination.ts:contextChunkQuery`); `LoadMore` pages in the rest from
  `/api/repos/:o/:r/context` on demand. The global view stays capped at 50.
- **Highlight theme** — one `highlight.js` `github.css` for light schemes,
  `.hljs` background dropped so the `.readme` box owns the surface, plus a small
  `[data-color-scheme='dark']` token patch covering both theme families.

## Acceptance Criteria

1. A markdown chunk (doc / adr / spec / pull_request / rule) renders as formatted markdown, and a repo-relative link inside it is rewritten to a GitHub blob URL that opens in a new tab. ([validated by `ChunkBody.test.tsx:14`](web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L14), [`github-links.test.ts:5`](web-ui/src/lib/github-links.test.ts#L5))
2. A code chunk is syntax-highlighted and carries a `symbol_type symbol_name · L{start}–{end}` header that links to the matching GitHub line range. ([validated by `ChunkBody.test.tsx:31`](web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L31), [`chunk-presenter.test.ts:5`](web-ui/src/lib/chunk-presenter.test.ts#L5), [`github-links.test.ts:57`](web-ui/src/lib/github-links.test.ts#L57), [`code-lang.test.ts:5`](web-ui/src/lib/code-lang.test.ts#L5))
3. The content-type filter renders one chip per type actually present in the data — never a hardcoded list — in a canonical order, each chip a link to its filtered view. ([validated by `ContextFilters.test.tsx:27`](web-ui/src/app/repos/[owner]/[repo]/context/ContextFilters.test.tsx#L27), [`content-types.test.ts:27`](web-ui/src/lib/content-types.test.ts#L27), [`ContextView.test.tsx:56`](web-ui/src/app/context/ContextView.test.tsx#L56), [`FilterChip.test.tsx:31`](web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L31))
4. The keyword search box seeds from the active query and preserves the active content-type filter when searching, so searching within a filtered view stays filtered. ([validated by `SearchForm.test.tsx:28`](web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L28), [`SearchForm.test.tsx:16`](web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L16), [`SearchForm.test.tsx:21`](web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L21))
5. Each chunk's file path links to a per-file detail page that shows the full, untruncated content of every chunk for that path. ([validated by `ContextCard.test.tsx:17`](web-ui/src/app/repos/[owner]/[repo]/context/ContextCard.test.tsx#L17), [`ContextFileView.test.tsx:21`](web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L21))
6. The global cross-repo view labels each chunk with its repo, and the global detail page groups a file's chunks by repo with a "view in repo →" link. ([validated by `ContextView.test.tsx:38`](web-ui/src/app/context/ContextView.test.tsx#L38), [`ContextFileView.test.tsx:48`](web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L48))
7. A list card shows a rich preview of the chunk's lead block — the first paragraph for prose (keeping a leading heading) or the first lines for code — with a metadata header, instead of the full body or a raw `<pre>` dump. ([validated by `preview-block.test.ts:5`](web-ui/src/lib/preview-block.test.ts#L5), [`preview-block.test.ts:10`](web-ui/src/lib/preview-block.test.ts#L10), [`preview-block.test.ts:19`](web-ui/src/lib/preview-block.test.ts#L19), [`ContextCard.test.tsx:35`](web-ui/src/app/repos/[owner]/[repo]/context/ContextCard.test.tsx#L35))
8. The per-repo list loads only the first page server-side and pages in the rest on demand via a "Load more" control that preserves the active query and type, advances the offset per page, and stops when no further page exists. ([validated by `LoadMore.test.tsx:28`](web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L28), [`LoadMore.test.tsx:45`](web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L45), [`LoadMore.test.tsx:57`](web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L57), [`LoadMore.test.tsx:71`](web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L71)) The shared query builder fetches one row past the page size to detect the next page. ([validated by `pagination.test.ts:5`](web-ui/src/app/repos/[owner]/[repo]/context/pagination.test.ts#L5), [`pagination.test.ts:12`](web-ui/src/app/repos/[owner]/[repo]/context/pagination.test.ts#L12))
9. The filter row shows a loading state while a navigation it triggered is in flight — a spinner on the active filter chip — and clears it when idle. ([validated by `FilterChip.test.tsx:51`](web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L51), [`FilterChip.test.tsx:61`](web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L61))

## Verification

- `npx tsc --noEmit` clean; `npm run build` (next build) succeeds — the new
  `/context/[...path]` and `/repos/[owner]/[repo]/context/[...path]` routes
  compile.
- `npm run test:coverage` — web-ui suite green under the 95 / 95 / 95 / 90 gate;
  the pure helpers and view components above carry the coverage.

## Out of Scope

- Changing ingestion — code files remain indexed for Search.
- Semantic / embedding search on this tab (keyword `search_tsv` only).
- Fetching each repo's real default branch — GitHub links assume `main`, matching
  the specs viewer.
