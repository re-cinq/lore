---
adr_number: 22
title: "Context assembly: hybrid (vector+BM25) ranking, a dedicated code source, and a per-document cap"
status: shipped
date: 2026-06-11
domains: [mcp-server, context, retrieval]
supersedes: [ADR-020]
---

# ADR-022: Context assembly — hybrid ranking + code retrieval + per-document cap

This ADR replaces keyword-only assembly ranking with hybrid vector+BM25 retrieval across the repo, ADR, and a new dedicated code source, so implementation tasks actually receive the files they edit, and caps any single document to half a section's token budget.

## Context

ADR-020 made `repo`/`adrs` rank by `ts_rank` (over recency) and **deferred**
embedding/cosine ranking. Debugging a real implementation task (`task.md`: add
UI controls for per-repo settings) against the live tool exposed that the
deferral was the dominant quality problem:

1. **Code is never retrieved.** The `repo` source filters `content_type IN
   ('doc','spec')` and no template had a `code` source — so an *implementation*
   task received **zero** of the files it edits (`settings/page.tsx`,
   `settings-form.ts`, …). Only docs/specs/ADRs/graph/memory came back.
2. **Keyword-only ranking → false relevance.** `ts_rank` over a long
   natural-language query rewards term overlap, floating an unrelated web-ui spec
   (`context-viewer`) to relevance `1.00` while the semantically-relevant code
   wasn't even a candidate. The hybrid vector+BM25 RRF that already powers
   `search_context` (`hybridSearch`) was not used by assembly.
3. **One mega-doc hogs the budget.** No per-document cap, so a single truncated
   `CLAUDE.md` (~2.4k tokens) dominated the Conventions section.

## Decision

1. **Hybrid retrieval for `repo`, `adrs`, and a new `code` source.** A shared
   `hybridChunkItems` helper runs Reciprocal-Rank-Fusion over `org_shared.chunks`
   — a pgvector cosine leg ⊕ a `ts_rank` BM25 leg (`RRF_K=60`, same as the
   memories source and `search_context`) — for a given repo + content-type set.
   It degrades to keyword-only when no query embedding is available (e.g. no
   Vertex credentials), so existing keyword-path tests and offline runs still work.
2. **A dedicated `code` source** (`content_type='code'`) added to the
   `implementation`, `review`, and `default` templates, so tasks get the actual
   source they touch — ranked semantically, not by keyword frequency.
3. **Per-document cap.** When a section has more than one document, no single
   document may exceed half the section budget; a lone document keeps the whole
   budget. One mega-doc can no longer crowd out smaller, more-relevant chunks.

### Phase 2 refinements

4. **Keyword leg searches distinctive terms.** A paragraph query is reduced to its
   key terms (stopwords/short words dropped) before the keyword leg, so filler
   words don't dominate ranking — the vector leg already carries the full query.
5. **Normalized relevance.** Scores are rescaled so the top result is `1.00` and
   the rest are proportional fractions; raw RRF/`ts_rank` scores (~0.02) were
   unreadable and identical-looking across a section.
6. **No cross-section duplication.** A document is emitted in its highest-priority
   section only (the same episode no longer appears in both Agent Memory and
   Recent Episodes).
7. **Repo-scoped graph.** `queryLiveGraph` drops the `repo IS NULL` clause, so a
   repo-scoped query never returns another repo's (or unattributed) entities; the
   graph section is also demoted in the implementation template (entity-level, not
   file-level).

Requirements + test-linked acceptance criteria: `specs/context-assembly/spec.md`
(FR-2.7, FR-2.9–2.13, FR-4.5).

## Consequences

- **Positive:** implementation/review context now contains the relevant code,
  ranked by meaning; doc ranking stops over-rewarding term overlap; the budget
  buys breadth instead of one giant doc.
- **Cost:** assembly now computes one query embedding (already done for the
  memories source) and runs an RRF query per local source instead of a single
  `ts_rank` scan — negligible at these row counts, and gated behind the existing
  pgvector index.
- **Unchanged:** XML output, dedup, `debug=1` trace, and the keyword-only
  fallback path all behave as in ADR-020.

## Alternatives considered

- **Fold code into the `repo` source's content-type set.** Rejected — code and
  prose would compete for one small row limit; a dedicated section with its own
  budget keeps both.
- **Keep `ts_rank`, just add code.** Rejected — keyword ranking is what produced
  the false-`1.00` doc match; the vector leg is what makes NL-query code
  retrieval actually work.
- **Cap every document unconditionally.** Rejected — it wastes budget on
  single-document sections; the cap applies only when documents compete.
