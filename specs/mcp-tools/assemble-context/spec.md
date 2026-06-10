# Feature Specification: assemble_context MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | assemble_context MCP Tool      |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `assemble_context`             |
| Module  | Context (`context-tools.ts`)   |
| Scope   | shared                         |

## Problem Statement

A Claude Code session starting a task needs conventions, ADRs, memories, facts,
episodes, and graph relationships before it can plan or build. Fetching these
one source at a time wastes the agent's first turns and leaves the caller to
stitch the pieces into a coherent, token-budgeted block. `assemble_context` is
the single call that retrieves from every source, orders sections by a
task-type template, fits a token budget, and emits a provenance-tagged block an
LLM consumes directly.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/context-tools.ts#L94)).

- **name**: `assemble_context`
- **description** (verbatim): *"Retrieve and assemble context from all sources
  (repo, ADRs, memories, facts, episodes, graph) into a single structured block
  optimized for LLM consumption. Replaces multiple get_context + search_memory +
  get_adrs calls. Uses configurable templates for task-type-specific context
  ordering."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `query` | string | yes | — | Natural-language description of needed context. |
| `template` | string | no | `"default"` | One of `default` \| `review` \| `implementation` \| `research`. Selects section ordering + budget profile. |
| `max_tokens` | number | no | `8000` | Token budget; floor 2000. Research queries may raise to ~16000. |
| `repo` | string | no | — | `owner/repo`. Auto-detected from the git remote when omitted. |
| `agent_id` | string | no | — | Overrides the resolved agent id. |
| `cross_repo` | boolean | no | `false` | Include context from linked repos. |

The whole handler body is wrapped in `trackLatency('assemble_context', …)` which
records latency + success into `memory.audit_log` and an OTEL span.

## Behavior

1. Acquire the pg pool via `getPool()`.
2. **Availability gate** — if `isMemoryDbAvailable()` is false:
   1. Read `LORE_API_URL` + `LORE_INGEST_TOKEN`.
   2. If **both** present, resolve `repo || detectCurrentRepo() || ""` and
      `GET {LORE_API_URL}/api/context?query=&template=&repo=` with
      `Authorization: Bearer {token}`. On a 2xx JSON response with a `text`
      field, return that text **prefixed** with the line
      `<!-- context: proxied from GKE, template={template} -->\n\n`. Any
      fetch/parse error falls through.
   3. If the proxy is not configured or fails, return the literal text
      `"Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured."`
3. **Cross-repo resolution** — start with the `cross_repo` argument; if false and
   a `repo` + pool are present, `SELECT settings FROM lore.repos WHERE full_name = $1`
   and enable cross-repo when `settings.cross_repo === true`. A query error is
   non-fatal (stays disabled).
4. Delegate to the engine
   `assembleContext(pool, query, template, max_tokens, repo, agent_id, enableCrossRepo)`
   ([engine](../../../shared/src/project/knowledge/context-assembly.ts#L441), re-exported
   [here](../../../mcp-server/src/features/context/context-assembly.ts#L7)). The engine
   returns `{ text, sections: { tokens, … }[] }` — its retrieval/ranking/XML-emission
   contract is owned by [`context-assembly`](../../context-assembly/spec.md).
5. **Empty guard** — if `result.text` is empty/whitespace, return
   `"No relevant context found for this query."`
6. **Success envelope** — return `result.text` prefixed with
   `<!-- context: template={template}, sections={N}, tokens={sum of section tokens} -->\n\n`.
7. Any thrown error is caught and returned as `"Error assembling context: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the success envelope
(meta comment + assembled text), the GKE-proxied envelope, the "no relevant
context" text, the "requires PostgreSQL or LORE_API_URL" text, or the
"Error assembling context: …" text. **Never throws** — every path returns text.

## Dependencies & side effects

- `isMemoryDbAvailable()`, `getPool()` (pool may be null), `detectCurrentRepo()`.
- `assembleContext` engine (PostgreSQL reads, optional Vertex embeddings).
- Read of `lore.repos.settings` for the cross-repo flag.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN` (proxy path only).
- Writes a latency row to `memory.audit_log` via `trackLatency`.

## Acceptance Criteria

The engine returns empty text and an empty section list when no source returns
rows. ([validated by `returns empty text when no sources return data`](../../../mcp-server/src/features/context/context-assembly.test.ts#L61))

A repo source returning a `doc` chunk yields a Conventions section containing
that chunk's content. ([validated by `assembles context from repo source`](../../../mcp-server/src/features/context/context-assembly.test.ts#L71))

Content exceeding the budget is truncated so the assembled text stays within the
token budget and the section is marked truncated. ([validated by `respects token budget`](../../../mcp-server/src/features/context/context-assembly.test.ts#L87))

Retrieved documents are emitted as XML tags carrying source/type/relevance
provenance with the chunk markdown contained inside the tag. ([validated by `emits XML-tagged documents carrying provenance, with markdown contained`](../../../mcp-server/src/features/context/context-assembly.test.ts#L107))

The debug trace reports per-section inclusion status and an omit reason for empty
sources. ([validated by `debug trace reports per-section status and omit reason for empty sources`](../../../mcp-server/src/features/context/context-assembly.test.ts#L149))

The handler's GKE-proxy fallback and the success/empty/error envelope framing are
exercised only against live Postgres or `LORE_API_URL`. *(untested: the handler
orchestration around the engine has no unit seam — the proxy branch needs a live
API and the success branch needs a populated DB; the engine itself is covered
above.)*

## Out of Scope

- The retrieval/ranking/XML engine internals — owned by [`context-assembly`](../../context-assembly/spec.md).
- Template authoring (`mcp-server/templates/*.yaml`).
- Vertex AI embedding generation and live Postgres RRF queries.
- Cross-repo transfer scoring (memory/retrieval module).
