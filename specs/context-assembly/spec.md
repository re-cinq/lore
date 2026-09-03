# Feature Specification: Context Assembly Templates

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Context Assembly Templates                  |
| Status         | In Progress                                   |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P2 — Higher value, higher effort            |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

Context Assembly Templates add a lore_assemble_context MCP tool that retrieves from all memory sources and formats the result through centrally managed context-block templates, replacing the ad-hoc, inconsistent context each agent used to assemble on its own.

## Problem Statement

Agents call `lore_search_memory` and `get_context` and receive raw text
back. Every agent then assembles its own context: deciding what to
include, how to order it, what format the LLM expects. This is
duplicated work across every agent session, and each agent does it
differently (and usually poorly).

The result: inconsistent context quality, wasted tokens on
irrelevant information, and no way to tune the context format
centrally. When we discover that a certain ordering or formatting
produces better LLM outputs, we have to update every agent's
prompting logic individually.

Zep's approach: **context blocks** — structured templates that
define how retrieved information is formatted before being sent to
the LLM. Context assembly is a separate, explicit step between
retrieval and prompting.

## Vision

A new `lore_assemble_context` MCP tool that takes a query and an
optional template name, retrieves relevant context from all
sources (memories, facts, episodes, graph, repo context), and
returns a single structured block optimized for LLM consumption.
Templates are centrally managed — tune once, every agent benefits.

## User Scenarios & Acceptance Criteria

### Scenario 1: Default Context Assembly

**Actor:** Any agent starting a task

**Flow:**
1. Agent calls `lore_assemble_context(query: "implement auth middleware")`.
2. System retrieves: relevant ADRs, CLAUDE.md conventions, recent
   memories about auth, graph entities for auth-related services,
   relevant PR history.
3. System assembles into structured sections with headers, ordered
   by relevance.
4. Agent receives a single text block ready to prepend to its
   prompt.

**Acceptance Criteria:**
- Single tool call replaces multiple `get_context` +
  `lore_search_memory` + `get_adrs` calls.
- Output is structured with clear section headers.
- Total output fits within a configurable token budget.
- Most relevant information appears first.

### Scenario 2: Task-Type Specific Templates

**Actor:** Pipeline agent executing a review task

**Flow:**
1. Agent calls `lore_assemble_context(query: "review PR #42",
   template: "review")`.
2. The "review" template prioritizes: conventions, ADRs, recent
   review feedback, coding patterns. It deprioritizes: project
   status, team info.
3. Agent receives context tuned for code review.

**Acceptance Criteria:**
- Different templates produce different context orderings and
  selections.
- Templates are defined in a config file, not code.
- Unknown template name falls back to default.

### Scenario 3: Token Budget Enforcement

**Actor:** Agent with a context window constraint

**Flow:**
1. Agent calls `lore_assemble_context(query: "...", max_tokens: 8000)`.
2. System assembles the most relevant context within the budget.
3. Lower-priority sections are truncated or omitted to fit.

**Acceptance Criteria:**
- Output never exceeds `max_tokens`. ([validated by `context-assembly.test.ts:122`](libs/server-core/src/features/context/context-assembly.test.ts#L122))
- Higher-priority sections are preserved; lower-priority ones
  are trimmed.
- If the budget is very small, only the most essential context
  is returned.

### Scenario 4: Traceable Assembly (Prompt Debug View)

**Actor:** A developer (or platform engineer) debugging why a session got the
context it did, via the web-ui **Assembled** tab.

**Flow:**
1. The tab calls `/api/context?...&debug=1`.
2. Assembly returns, alongside the prompt, a **trace**: per-section status,
   allocated budget, the exact documents pulled (path, type, tokens, relevance,
   ingested date), and the reason any section was omitted.
3. The tab renders inputs + budget summary + per-section trace cards + the prompt
   as a nested `context → section → document` tag tree.

**Acceptance Criteria:**
- A `debug=1` assembly returns a per-section trace carrying each source's status
  and, when omitted, the reason (no results / no rule matched / budget exhausted).
  ([validated by `context-assembly.test.ts:282`](libs/server-core/src/features/context/context-assembly.test.ts#L282))
- The trace maps 1:1 to a nested `context/section/document` tag tree, dropping
  omitted sections and marking only the last document of a truncated section.
  ([validated by `tag-tree.test.ts:52`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/tag-tree.test.ts#L52), [`tag-tree.test.ts:63`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/tag-tree.test.ts#L63))
- The debug view renders an included source card and an omitted one with its
  reason, links every contributing document to its context detail page, and shows
  the prompt as the tag tree. ([validated by `AssembledContextView.test.tsx:135`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L135), [`AssembledContextView.test.tsx:172`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L172), [`AssembledContextView.test.tsx:181`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L181))

## Functional Requirements

### FR-1: lore_assemble_context MCP Tool

- FR-1.1: `lore_assemble_context(query, template?, max_tokens?,
  repo?, agent_id?)` is the single entry point.
- FR-1.2: Returns a structured text block with section headers.
- FR-1.3: `max_tokens` defaults to 16000. Minimum 2000.
- FR-1.4: `template` defaults to "default".

### FR-2: Context Sources

The tool retrieves from all available sources:

- FR-2.1: **Repo context** — CLAUDE.md, project structure
  (from `get_context` logic).
- FR-2.2: **ADRs** — relevant architecture decisions
  (from `get_adrs` logic).
- FR-2.3: **Memories** — agent-specific and shared pool memories
  (from `lore_search_memory` logic).
- FR-2.4: **Facts** — including episode-derived facts
  (from `lore_search_memory` fact search).
- FR-2.5: **Graph** — related entities and relationships
  (from `lore_query_graph` logic, 1-hop).
- FR-2.6: Each source is retrieved in parallel.
- FR-2.7: **Hybrid relevance ranking.** The local `repo`, `code`, and `adrs`
  sources rank by a Reciprocal-Rank-Fusion of a pgvector cosine leg and a BM25
  (`ts_rank`) leg — the same hybrid that powers `search_context` — so a
  natural-language query surfaces semantically-relevant chunks, not just keyword
  overlap. Degrades to keyword-only (`ts_rank`/`websearch_to_tsquery`) when no
  query embedding is available. ([validated by `context-assembly.test.ts:189`](libs/server-core/src/features/context/context-assembly.test.ts#L189), [`uses a vector+keyword RRF query when an embedding is available`](libs/shared/src/project/knowledge/context-assembly.test.ts#L281))
- FR-2.8: **No cross-section duplication.** The `repo`/Conventions source pulls
  only `doc`/`spec` (never `adr`, which is its own section), and chunks sharing a
  `file_path` are de-duplicated, keeping the highest-scoring copy. ([validated by `context-assembly.test.ts:216`](libs/server-core/src/features/context/context-assembly.test.ts#L216), [`context-assembly-format.test.ts:23`](libs/shared/src/project/knowledge/context-assembly-format.test.ts#L23), [`context-assembly-format.test.ts:35`](libs/shared/src/project/knowledge/context-assembly-format.test.ts#L35))
- FR-2.9: **Code retrieval.** A dedicated `code` source retrieves
  `content_type='code'` chunks via the same hybrid ranking, so implementation and
  review tasks receive the actual source files they edit (previously code was
  never retrieved — the `repo` source excluded it). ([validated by `context-assembly.test.ts:243`](libs/server-core/src/features/context/context-assembly.test.ts#L243), [`context-assembly.test.ts:218`](libs/shared/src/project/knowledge/context-assembly.test.ts#L218))
- FR-2.10: **Keyword leg searches distinctive terms.** A paragraph-length query
  is reduced to its distinctive terms (stopwords + ≤2-char words dropped, capped)
  for the keyword leg, so common filler words don't dominate ranking. ([validated by `context-assembly.test.ts:119`](libs/shared/src/project/knowledge/context-assembly.test.ts#L119), [`context-assembly.test.ts:132`](libs/shared/src/project/knowledge/context-assembly.test.ts#L132))
- FR-2.11: **Normalized relevance.** Item scores are rescaled so the top result
  is `1.00` and the rest are proportional fractions — raw RRF/`ts_rank` scores are
  tiny (~0.02) and unreadable as a relevance signal. ([validated by `context-assembly.test.ts:351`](libs/shared/src/project/knowledge/context-assembly.test.ts#L351))
- FR-2.12: **No cross-section duplication.** A document is emitted in its
  highest-priority section only — the same item never appears in two sections
  (e.g. an episode in both Agent Memory and Recent Episodes). ([validated by `context-assembly.test.ts:148`](libs/shared/src/project/knowledge/context-assembly.test.ts#L148))
- FR-2.13: **Repo-scoped graph.** The knowledge-graph source returns only
  entities scoped to the queried repo (no NULL-repo globals), so a task never sees
  another repo's entities.
- FR-2.14: **Repo-bound assembly.** Every source read threads the queried repo —
  the `KnowledgeView` facade and the Pg engine both bind the repo — so a task
  assembles only its own repo's context. ([validated by `assembles context scoped to the repo`](libs/shared/src/project/knowledge/knowledge.test.ts#L32), [`knowledge-pg.test.ts:112`](libs/shared/src/project/knowledge/knowledge-pg.test.ts#L112))
- FR-2.15: **Team-schema resolution.** Repo-scoped chunk reads (`repo`, `code`,
  `adrs`, `rules`) resolve the repo's chunk schema — its provisioned team schema,
  else `org_shared` — before querying, matching where reindex actually wrote the
  repo's chunks; the `cross_repo` source instead UNIONs every provisioned chunk
  schema plus `org_shared`, since linked repos may live in any team schema. ([validated by `reads from the repo's provisioned team schema instead of org_shared`](libs/shared/src/project/knowledge/context-assembly.test.ts#L255), [`retrieves chunks bound to the repo + content types (keyword path when no embedding)`](libs/shared/src/project/knowledge/context-assembly.test.ts#L218), [`cross_repo unions linked-repo matches across every provisioned chunk schema`](libs/shared/src/project/knowledge/context-assembly.test.ts#L306), [`cross_repo without linked repos searches other repos across all schemas`](libs/shared/src/project/knowledge/context-assembly.test.ts#L337), [`resolves the repo's team schema when it is provisioned`](libs/shared/src/project/chunks/chunk-schema.test.ts#L68))

### FR-3: Template System

- FR-3.1: Templates are YAML files in a configurable directory
  (default: `mcp-server/templates/`). ([validated by `context-assembly.test.ts:54`](libs/server-core/src/features/context/context-assembly.test.ts#L54))
- FR-3.2: A template defines:
  - `sections`: ordered list of context sections to include.
  - `section.source`: which source to pull from (repo, adrs,
    memories, facts, graph).
  - `section.priority`: 1 (highest) to 5 (lowest). Determines
    truncation order when token budget is tight.
  - `section.max_tokens`: per-section token budget (optional).
  - `section.header`: the section header in the output.
  - `section.filter`: optional filter (e.g., only ADRs with
    status "accepted").
- FR-3.3: The "default" template includes all sources with
  sensible priorities.
- FR-3.4: Built-in templates: "default", "review", "implementation",
  "research".

### FR-4: Token Budget Allocation

- FR-4.1: Total budget is divided across sections proportional to
  priority and available content.
- FR-4.2: Empty sections (no results) release their budget to
  other sections.
- FR-4.3: Token counting uses a simple approximation
  (chars / 4) — no tokenizer dependency. ([validated by `context-assembly.test.ts:26`](libs/server-core/src/features/context/context-assembly.test.ts#L26))
- FR-4.4: When content exceeds a section's budget, it is truncated
  at a paragraph boundary with a "(truncated)" marker; content under
  budget is returned unchanged. ([validated by `context-assembly.test.ts:40`](libs/server-core/src/features/context/context-assembly.test.ts#L40), [`context-assembly.test.ts:34`](libs/server-core/src/features/context/context-assembly.test.ts#L34))
- FR-4.5: **Per-document cap.** When a section has more than one document,
  no single document may exceed half the section budget — so one mega-doc
  (e.g. CLAUDE.md) cannot crowd out several smaller, more-relevant chunks. A
  lone document keeps the whole budget. ([validated by `context-assembly.test.ts:169`](libs/shared/src/project/knowledge/context-assembly.test.ts#L169), [`context-assembly.test.ts:185`](libs/shared/src/project/knowledge/context-assembly.test.ts#L185))

### FR-5: Output Format

- FR-5.1: Output is a single **XML-tagged** string: `<context>` wraps one
  `<section>` per included template section, each wrapping one `<document>`
  per contributing chunk. Provenance lives in tag attributes (`source`, `type`,
  `relevance`, `tokens`, `truncated`); the chunk's own markdown is contained
  inside the tag, so document headings and YAML `---` fences cannot collide with
  the structural skeleton. ([validated by `context-assembly-format.test.ts:69`](libs/shared/src/project/knowledge/context-assembly-format.test.ts#L69), [`context-assembly-format.test.ts:43`](libs/shared/src/project/knowledge/context-assembly-format.test.ts#L43), [`context-assembly.test.ts:151`](libs/server-core/src/features/context/context-assembly.test.ts#L151), [`context-assembly-format.test.ts:17`](libs/shared/src/project/knowledge/context-assembly-format.test.ts#L17))
- FR-5.2: Format:
  ```xml
  <context query="…" template="implementation" budget="8000">
    <section name="Architecture Decisions" source="adrs" priority="1">
      <document source="adrs/ADR-016-dark-factory.md" type="adr" relevance="0.83" tokens="640">
      …content…
      </document>
    </section>
  </context>
  ```
- FR-5.3: Empty sections are omitted from output.
- FR-5.4: A truncated document carries `truncated="true"` rather than an inline
  `...(truncated)` marker. ([validated by `context-assembly-format.test.ts:59`](libs/shared/src/project/knowledge/context-assembly-format.test.ts#L59))

## Non-Functional Requirements

### NFR-1: Performance

- `lore_assemble_context` returns in under 500ms (parallel retrieval
  from all sources).
- Template loading is cached at startup (not read from disk on
  every call).

### NFR-2: Observability

- Debug mode (`debug=1`) returns a full assembly trace: per-section status,
  allocated budget, raw vs final tokens, truncation, omit reason, and the
  contributing documents with provenance. ([validated by `context-assembly.test.ts:282`](libs/server-core/src/features/context/context-assembly.test.ts#L282))
- Audit log records each `lore_assemble_context` call with: query, template used,
  sources hit, total tokens returned. *(Audit-log persistence is tracked as
  follow-up — the in-memory trace lands first.)*

## Scope Boundaries

### In Scope

- `lore_assemble_context` MCP tool.
- Template YAML format and built-in templates.
- Token budget allocation.
- Parallel retrieval from existing sources.

### Out of Scope

- LLM-based summarization within assembly (just retrieval +
  formatting, no additional LLM calls).
- Dynamic template selection based on query analysis.
- Template management UI.
- Template versioning.

## Dependencies

- Episode ingestion (episodes as a fact source).
- Live knowledge graph (graph as a context source).
- Existing `get_context`, `get_adrs`, `lore_search_memory` logic
  (reused internally, not replaced).

## Success Criteria

1. A single `lore_assemble_context` call replaces 3+ separate MCP
   tool calls for agents starting a task.
2. The "review" template produces measurably more relevant context
   for code review tasks than the generic `get_context` call.
3. Token budget is respected — output never exceeds the requested
   limit.
4. Adding or modifying a template requires only a YAML file
   change, no code changes.
5. Context assembly latency stays under 500ms despite hitting
   multiple sources.
