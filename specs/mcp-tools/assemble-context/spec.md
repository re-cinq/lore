# Feature Specification: lore_assemble_context MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_assemble_context MCP Tool      |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_assemble_context`             |
| Module  | Context (`context-tools.ts`)   |
| Scope   | shared                         |

`lore_assemble_context` is the mandatory first call for a task: it pulls from every knowledge source at once — conventions, ADRs, memories, facts, episodes, and graph relationships — and returns one token-budgeted, template-ordered, provenance-tagged block an agent consumes directly.

## Problem Statement

A Claude Code session starting a task needs conventions, ADRs, memories, facts,
episodes, and graph relationships before it can plan or build. Fetching these
one source at a time wastes the agent's first turns and leaves the caller to
stitch the pieces into a coherent, token-budgeted block. `lore_assemble_context` is
the single call that retrieves from every source, orders sections by a
task-type template, fits a token budget, and emits a provenance-tagged block an
LLM consumes directly.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/context-tools.ts#L94)).

- **name**: `lore_assemble_context`
- **description** (verbatim):

```text
Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `query` | string | yes | — | Natural-language description of the context needed. Drives retrieval and ranking across all sources. |
| `template` | string | no | `default` | Section-ordering profile. Recognized values: 'default' \| 'review' \| 'implementation' \| 'research'. Unrecognized values silently fall back to 'default'. Note: template choice does NOT raise the token budget — max_tokens always defaults to 8000 regardless of template, so pass max_tokens explicitly for research queries. |
| `max_tokens` | number | no | `8000` | Token budget for the assembled block; floor 2000. Raise to ~16000 for research-heavy queries. Defaults to 8000. |
| `repo` | string | no | — | 'owner/repo'. Auto-detected from the git remote when omitted. |
| `agent_id` | string | no | — | Overrides the ambient agent id used to scope memories/facts. |
| `cross_repo` | boolean | no | `false` | When true, also pulls context from linked repos in the org. Falls back to the repo's settings.cross_repo when false. |

The whole handler body is wrapped in `trackLatency('lore_assemble_context', …)` which
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
   ([engine](../../../libs/shared/src/project/knowledge/context-assembly.ts#L441), re-exported
   [here](../../../apps/mcp-server/src/features/context/context-assembly.ts#L7)). The engine
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
rows. ([validated by `returns empty text when no sources return data`](libs/server-core/src/features/context/context-assembly.test.ts#L75))

A repo source returning a `doc` chunk yields a Conventions section containing
that chunk's content. ([validated by `assembles context from repo source`](libs/server-core/src/features/context/context-assembly.test.ts#L91))

Content exceeding the budget is truncated so the assembled text stays within the
token budget and the section is marked truncated. ([validated by `respects token budget`](libs/server-core/src/features/context/context-assembly.test.ts#L125))

Retrieved documents are emitted as XML tags carrying source/type/relevance
provenance with the chunk markdown contained inside the tag. ([validated by `emits XML-tagged documents carrying provenance, with markdown contained`](libs/server-core/src/features/context/context-assembly.test.ts#L153))

The debug trace reports per-section inclusion status and an omit reason for empty
sources. ([validated by `debug trace reports per-section status and omit reason for empty sources`](libs/server-core/src/features/context/context-assembly.test.ts#L278))

On the proxy path, a reachable backend response is authoritative over any cached
copy: an empty-but-reachable context is returned as-is (never a stale cache), and
a reachable non-empty response returns the live text. ([validated by `returns an empty-but-reachable context as-is instead of a stale cached copy`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L156), [validated by `returns the live result on a reachable hit`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L192))

The pre-run context-hydration URL selects the `review` template for review tasks
and `implementation` for every other task type, truncates the query to 200 chars,
and URL-encodes both the repo and query. ([validated by `uses implementation template by default`](apps/mcp-server/src/features/context/context-hydration.test.ts#L21), [validated by `uses review template for review tasks`](apps/mcp-server/src/features/context/context-hydration.test.ts#L32), [validated by `uses implementation template for general tasks`](apps/mcp-server/src/features/context/context-hydration.test.ts#L43), [validated by `truncates query to 200 chars`](apps/mcp-server/src/features/context/context-hydration.test.ts#L54), [validated by `encodes special characters in repo name`](apps/mcp-server/src/features/context/context-hydration.test.ts#L68), [validated by `encodes special characters in query`](apps/mcp-server/src/features/context/context-hydration.test.ts#L79))

When pre-loaded context is available the spawned agent's preamble carries it and
drops the "call lore_assemble_context first" workflow instruction; with no
pre-loaded context the preamble falls back to that instruction. ([validated by `includes pre-loaded context when available`](apps/mcp-server/src/features/context/context-hydration.test.ts#L97), [validated by `falls back to lore_assemble_context instruction when no pre-loaded context`](apps/mcp-server/src/features/context/context-hydration.test.ts#L122))

The `/api/context` endpoint runs full assembly when a `query` param is present and
a raw chunk fetch when it is absent, and caps the pre-hydration token budget at
8000 (below the 16000 default). ([validated by `should use full assembly when query param is present`](apps/mcp-server/src/features/context/context-hydration.test.ts#L149), [validated by `should use raw chunk fetch when no query param`](apps/mcp-server/src/features/context/context-hydration.test.ts#L161), [validated by `should cap token budget at 8000 for pre-hydration`](apps/mcp-server/src/features/context/context-hydration.test.ts#L169))

The `max_tokens` input schema enforces the documented floor of 2000 — a lower
value is rejected and the floor itself is accepted.
([validated by `rejects max_tokens below the 2000 floor`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L138), [validated by `accepts max_tokens at the 2000 floor`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L146))

The handler's GKE-proxy success/empty/error envelope framing on the DB-backed path
is exercised only against live Postgres. *(untested: the success branch needs a
populated DB; the engine itself is covered above.)*

## Out of Scope

- The retrieval/ranking/XML engine internals — owned by [`context-assembly`](../../context-assembly/spec.md).
- Template authoring (`mcp-server/templates/*.yaml`).
- Vertex AI embedding generation and live Postgres RRF queries.
- Cross-repo transfer scoring (memory/retrieval module).
