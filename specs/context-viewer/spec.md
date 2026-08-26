# Feature Specification: Context Viewer

| Field    | Value                 |
|----------|-----------------------|
| Feature  | Context Viewer        |
| Branch   | feat/context-tab-rich |
| Status   | In Progress           |
| Created  | 2026-06-04            |
| Owner    | Platform Engineering  |
| PR       | #516                  |

The Context Viewer brings the UI's Context tab to parity with the specs viewer, replacing raw truncated chunk dumps with rich per-content-type rendering, clickable file paths that link to per-file detail pages, a data-driven type filter, and keyword search over the search_tsv index.

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

1. A markdown chunk (doc / adr / spec / pull_request / rule) renders as formatted markdown, and a repo-relative link inside it is rewritten to a GitHub blob URL that opens in a new tab; when the repo is unknown the link is left relative and does not open in a new tab. ([validated by `ChunkBody.test.tsx:14`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L14), [`ChunkBody.test.tsx:94`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L94), [`github-links.test.ts:5`](apps/web-ui/src/lib/github-links.test.ts#L5))

2. A code chunk is syntax-highlighted and carries a `symbol_type symbol_name · L{start}–{end}` header that links to the matching GitHub line range. ([validated by `ChunkBody.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L32), [`chunk-presenter.test.ts:5`](apps/web-ui/src/lib/chunk-presenter.test.ts#L5), [`github-links.test.ts:58`](apps/web-ui/src/lib/github-links.test.ts#L58), [`code-lang.test.ts:5`](apps/web-ui/src/lib/code-lang.test.ts#L5))

3. The content-type filter renders one chip per type actually present in the data — never a hardcoded list — in a canonical order (unknown types sorted after known ones, alphabetically), each chip labelled with underscores turned to spaces and linking to its filtered view (a `?type=`/`?q=` href built off the base path). ([validated by `ContextFilters.test.tsx:27`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFilters.test.tsx#L27), [`RepoContextView.test.tsx:63`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L63), [`content-types.test.ts:33`](apps/web-ui/src/lib/content-types.test.ts#L33), [`content-types.test.ts:42`](apps/web-ui/src/lib/content-types.test.ts#L42), [`content-types.test.ts:23`](apps/web-ui/src/lib/content-types.test.ts#L23), [`content-types.test.ts:27`](apps/web-ui/src/lib/content-types.test.ts#L27), [`content-types.test.ts:52`](apps/web-ui/src/lib/content-types.test.ts#L52), [`content-types.test.ts:56`](apps/web-ui/src/lib/content-types.test.ts#L56), [`content-types.test.ts:60`](apps/web-ui/src/lib/content-types.test.ts#L60), [`content-types.test.ts:66`](apps/web-ui/src/lib/content-types.test.ts#L66), [`ContextView.test.tsx:66`](apps/web-ui/src/app/context/ContextView.test.tsx#L66), [`FilterChip.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L32))

The chip for the active content type — or the All chip when none is selected — is rendered active, and every other chip inactive. ([validated by `ContextFilters.test.tsx:35`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFilters.test.tsx#L35), [`ContextFilters.test.tsx:41`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFilters.test.tsx#L41), [`ContextView.test.tsx:75`](apps/web-ui/src/app/context/ContextView.test.tsx#L75), [`FilterChip.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L32), [`FilterChip.test.tsx:44`](apps/web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L44))

4. The keyword search box seeds from the active query and preserves the active content-type filter when searching, so searching within a filtered view stays filtered; clearing the query navigates to the bare base path, and a content-type chip carries the active query in its href. ([validated by `SearchForm.test.tsx:31`](apps/web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L31), [`SearchForm.test.tsx:17`](apps/web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L17), [`SearchForm.test.tsx:22`](apps/web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L22), [`SearchForm.test.tsx:40`](apps/web-ui/src/app/repos/[owner]/[repo]/context/SearchForm.test.tsx#L40), [`ContextFilters.test.tsx:65`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFilters.test.tsx#L65), [`ContextFilters.test.tsx:53`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFilters.test.tsx#L53))

5. Each chunk's file path links to a per-file detail page that shows the full, untruncated content of every chunk for that path, with a separator rule between multiple chunks in a group. ([validated by `ContextCard.test.tsx:17`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextCard.test.tsx#L17), [`ContextFileView.test.tsx:29`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L29), [`ContextFileView.test.tsx:86`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L86))

6. The global cross-repo view labels each chunk with its repo (a card shows the repo label only when one is passed), and the global detail page groups a file's chunks by repo with a "view in repo →" link; a single per-repo group omits the repo header. ([validated by `ContextView.test.tsx:38`](apps/web-ui/src/app/context/ContextView.test.tsx#L38), [`ContextCard.test.tsx:65`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextCard.test.tsx#L65), [`ContextFileView.test.tsx:60`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L60), [`ContextFileView.test.tsx:49`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L49))

7. A list card shows a rich preview of the chunk's lead block — the first paragraph for prose (keeping a leading heading) or the first lines for code — with a metadata header, instead of the full body or a raw `<pre>` dump; in preview mode the chunk body omits its header and clamps its content. ([validated by `preview-block.test.ts:5`](apps/web-ui/src/lib/preview-block.test.ts#L5), [`preview-block.test.ts:12`](apps/web-ui/src/lib/preview-block.test.ts#L12), [`preview-block.test.ts:22`](apps/web-ui/src/lib/preview-block.test.ts#L22), [`ContextCard.test.tsx:46`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextCard.test.tsx#L46), [`ChunkBody.test.tsx:78`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L78))

8. The per-repo list loads only the first page server-side and pages in the rest on demand via a "Load more" control that preserves the active query and type, advances the offset per page, and stops when no further page exists. ([validated by `LoadMore.test.tsx:28`](apps/web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L28), [`LoadMore.test.tsx:48`](apps/web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L51), [`LoadMore.test.tsx:72`](apps/web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L76), [`LoadMore.test.tsx:86`](apps/web-ui/src/app/repos/[owner]/[repo]/context/LoadMore.test.tsx#L90))

The shared page reader asks lore-api for one row past the page size to detect the next page, trimming the extra row off what it returns and rendering an empty page rather than throwing when the read fails. The per-repo context list no longer builds SQL at all: the chunks live in per-team schemas and lore-api owns that union. ([validated by asks lore-api for the repo's page at the given offset](apps/web-ui/src/app/repos/[owner]/[repo]/context/context-data.test.ts#L19), [`context-data.test.ts:33`](apps/web-ui/src/app/repos/[owner]/[repo]/context/context-data.test.ts#L33), [`context-data.test.ts:45`](apps/web-ui/src/app/repos/[owner]/[repo]/context/context-data.test.ts#L45), [`context-data.test.ts:53`](apps/web-ui/src/app/repos/[owner]/[repo]/context/context-data.test.ts#L53))

9. The filter row shows a loading state while a navigation it triggered is in flight — a spinner on the active filter chip — and clears it when idle. ([validated by `FilterChip.test.tsx:53`](apps/web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L53), [`FilterChip.test.tsx:64`](apps/web-ui/src/app/repos/[owner]/[repo]/context/FilterChip.test.tsx#L64))

10. Each list card shows the chunk's content type as a badge in the type's color, falling back to a plain badge for unknown types. The `content_type` column is nullable, so a chunk without one is resolved to a single `unknown` stand-in at the boundary — one stand-in for the badge and the preview both, never one each. ([validated by `ContextCard.test.tsx:33`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextCard.test.tsx#L33), [`content-types.test.ts:11`](apps/web-ui/src/lib/content-types.test.ts#L11), [`content-types.test.ts:17`](apps/web-ui/src/lib/content-types.test.ts#L17), [`content-types.test.ts:74`](apps/web-ui/src/lib/content-types.test.ts#L74), [`content-types.test.ts:78`](apps/web-ui/src/lib/content-types.test.ts#L78), [`content-types.test.ts:82`](apps/web-ui/src/lib/content-types.test.ts#L82))

11. A non-code chunk's header shows its section title and a plain GitHub blob link with no line range. ([validated by `ChunkBody.test.tsx:59`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L59))

12. The per-repo context view shows a chunk-count line derived from the number of chunks and a help popover — with a lead description — explaining how the repo's context is used. ([validated by `RepoContextView.test.tsx:37`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L37), [`RepoContextView.test.tsx:117`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L117))

13. When a view has no matching chunks it shows a contextual empty state: a first-run "nothing ingested yet" message with no clear-filters link when nothing has been ingested, or a scoped empty state naming the active search query or type filter — with a clear-filters link — when a filter or search yields nothing; a detail page for an unknown file path shows a Not Found state. ([validated by `ContextView.test.tsx:83`](apps/web-ui/src/app/context/ContextView.test.tsx#L83), [`ContextView.test.tsx:89`](apps/web-ui/src/app/context/ContextView.test.tsx#L89), [`ContextView.test.tsx:98`](apps/web-ui/src/app/context/ContextView.test.tsx#L98), [`RepoContextView.test.tsx:78`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L78), [`RepoContextView.test.tsx:93`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L93), [`RepoContextView.test.tsx:108`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L108), [`ContextFileView.test.tsx:15`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ContextFileView.test.tsx#L15))

14. Prose chunk markdown is sanitized after raw-HTML parsing: an injected `<script>` renders nothing executable, an `onerror` attribute is stripped from raw `<img>` HTML, and an injected `<svg onload>` is dropped, while fenced-code syntax highlighting and GFM tables survive the sanitizer. ([validated by `ChunkBody.test.tsx:111`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L111), [`ChunkBody.test.tsx:127`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L127), [`ChunkBody.test.tsx:145`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L145), [`ChunkBody.test.tsx:160`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L160), [`ChunkBody.test.tsx:174`](apps/web-ui/src/app/repos/[owner]/[repo]/context/ChunkBody.test.tsx#L174))

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
