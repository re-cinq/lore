---
adr_number: 20
title: "Context assembly: XML-tagged output + relevance-ranked, deduped retrieval"
status: shipped
date: 2026-06-05
domains: [mcp-server, context, retrieval, web-ui]
---

# ADR-020: Context assembly — XML-tagged output + relevance-ranked, deduped retrieval

Reworks context assembly to rank local sources by ts_rank relevance and dedupe by file path, and to serialize the block as XML-tagged documents with provenance instead of a collision-prone markdown blob.

## Context

`lore_assemble_context` builds the context block every Claude session and task runner
receives on turn 1 (see `specs/context-assembly/`). Two defects, invisible from
the old Assembled tab, made that block lower-quality than it looked:

1. **Recency-only retrieval.** The `repo` and `adrs` sources ordered by
   `ingested_at DESC`, so a task's directly-relevant ADR was routinely buried
   behind whatever was ingested most recently. Only `cross_repo` ranked by
   `ts_rank`. The `repo` source also pulled `content_type='adr'`, double-counting
   every ADR under both "Conventions" and "Architecture Decisions", and
   re-ingested chunks were never deduped — so the same document appeared several
   times and crowded the budget.
2. **Markdown-blob serialization.** Sections were joined as `## header` + `---`.
   The chunks' own `##` headings and YAML `---` fences collided with that
   skeleton, and there was no per-document provenance — an LLM (and a human) could
   not tell where one document ended or where it came from.

Both are changes to what *every* runner receives, so they are recorded here rather
than buried in the feature spec.

## Decision

1. **Relevance-ranked, deduped local retrieval.** `repo` and `adrs` rank by
   `ts_rank(search_tsv, websearch_to_tsquery('english', query))` (recency only as
   a tiebreak). The `repo` source drops `'adr'` from its content-type set, and
   items sharing a `file_path` are de-duplicated, keeping the highest-scoring copy.
2. **XML-tagged output.** The assembled block is `<context>` → `<section>` →
   `<document>`, with provenance (`source`, `type`, `relevance`, `tokens`,
   `truncated`) in attributes and the chunk's markdown contained inside the tag.
   Truncation is the `truncated="true"` attribute, not an inline marker.
3. **Traceable by construction.** Sources return structured items + a status that
   explains emptiness; a `debug=1` flag returns a full assembly trace (per-section
   status, budget, documents, omit reason). The web-ui Assembled tab is a
   prompt-debug view over that trace.

Requirements and test-linked acceptance criteria live in
`specs/context-assembly/spec.md` (FR-2.7/2.8, FR-5, Scenario 4, NFR-2).

## Consequences

- **Positive:** the relevant ADR/doc surfaces instead of the newest one; the
  budget stops paying for duplicate chunks; the prompt is unambiguous to parse and
  cite; and every assembly decision is inspectable in the UI.
- **Behavior change for all runners:** turn-1 context is now XML, not a markdown
  blob. Agents already treat it as reference text, so no prompt change is required,
  but downstream code that string-matched the old `## header` format must adapt.
- **Accepted:** `ts_rank` adds a ranking expression to two hot queries (negligible
  at these row counts); token estimation stays `chars/4`.

## Alternatives considered

- **Keep markdown, just fix ranking.** Rejected — the heading/`---` collisions and
  the missing provenance are independent defects the format change fixes at once.
- **Embedding/cosine ranking for local sources.** Deferred here — `ts_rank` over
  the existing `search_tsv` GIN index is already indexed, cheap, and a large
  improvement over recency. **Superseded by ADR-022**, which adds the hybrid
  vector+BM25 leg (and a dedicated `code` source) after keyword-only ranking
  proved to surface false-relevant docs and never retrieve code.
- **Separate debug endpoint.** Rejected — a `debug` flag on the same path keeps the
  preview byte-for-byte faithful to what runners receive.
