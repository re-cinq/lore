# graveyard/

Retired documentation, kept for history — **not indexed by Lore**.

Everything under this folder describes a system, design, or one-time procedure
that no longer exists in the codebase: the LoreTask-CRD execution model (retired
by ADR-031), the GraphRAG / Context-Core / Langfuse research stack, and a set of
completed one-time cutover runbooks. A [2026-07-16 documentation census](https://github.com/re-cinq/lore/issues/889)
found these still being ingested into the pgvector chunk store and the dgraph
trace graph, polluting context assembly and the web-UI spec lists.

## The exclusion guarantee

Nothing here reaches any index:

- **pgvector** — `classifyFile()` (`libs/shared/src/content-classify.ts`) returns
  `null` for every repo-root `graveyard/` path, and it is the single chokepoint
  both ingest paths share (lore-api `POST /api/ingest` and the floor nightly
  reindex), so a graveyard file is never chunked or embedded.
- **dgraph** — the projection prefixes are `specs/`, `.specify/`, `adrs/`; a
  `graveyard/specs/…` path fails all of them in `selectIngestFiles`, so it is
  never projected. (Whatever these docs left behind before the move is deleted
  by the whole-file prune that ships alongside this exclusion.)
- **eslint** — the markdown rules are scoped to `specs/**/spec.md` and
  `adrs/**/*.md`; graveyard paths match neither, so they are not linted.

## Rules for this folder

- Move docs **in** when their subject is gone; do not resurrect them here.
- Living docs must not link **in** except as history (a moved doc still 404s on
  GitHub if a live doc points at its old path — rewrite those links to the
  graveyard path or drop them).
- `.specify/memory/constitution.md` stayed put — it is generated and alive; only
  the retired `.specify/spec.md` + `tasks.md` moved here (under `specify/`).
