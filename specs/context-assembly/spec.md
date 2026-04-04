# Feature Specification: Context Assembly Templates

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Context Assembly Templates                  |
| Status         | Draft                                       |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P2 — Higher value, higher effort            |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

## Problem Statement

Agents call `search_memory` and `get_context` and receive raw text
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

A new `assemble_context` MCP tool that takes a query and an
optional template name, retrieves relevant context from all
sources (memories, facts, episodes, graph, repo context), and
returns a single structured block optimized for LLM consumption.
Templates are centrally managed — tune once, every agent benefits.

## User Scenarios & Acceptance Criteria

### Scenario 1: Default Context Assembly

**Actor:** Any agent starting a task

**Flow:**
1. Agent calls `assemble_context(query: "implement auth middleware")`.
2. System retrieves: relevant ADRs, CLAUDE.md conventions, recent
   memories about auth, graph entities for auth-related services,
   relevant PR history.
3. System assembles into structured sections with headers, ordered
   by relevance.
4. Agent receives a single text block ready to prepend to its
   prompt.

**Acceptance Criteria:**
- Single tool call replaces multiple `get_context` +
  `search_memory` + `get_adrs` calls.
- Output is structured with clear section headers.
- Total output fits within a configurable token budget.
- Most relevant information appears first.

### Scenario 2: Task-Type Specific Templates

**Actor:** Pipeline agent executing a review task

**Flow:**
1. Agent calls `assemble_context(query: "review PR #42",
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
1. Agent calls `assemble_context(query: "...", max_tokens: 8000)`.
2. System assembles the most relevant context within the budget.
3. Lower-priority sections are truncated or omitted to fit.

**Acceptance Criteria:**
- Output never exceeds `max_tokens`.
- Higher-priority sections are preserved; lower-priority ones
  are trimmed.
- If the budget is very small, only the most essential context
  is returned.

## Functional Requirements

### FR-1: assemble_context MCP Tool

- FR-1.1: `assemble_context(query, template?, max_tokens?,
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
  (from `search_memory` logic).
- FR-2.4: **Facts** — including episode-derived facts
  (from `search_memory` fact search).
- FR-2.5: **Graph** — related entities and relationships
  (from `query_graph` logic, 1-hop).
- FR-2.6: Each source is retrieved in parallel.

### FR-3: Template System

- FR-3.1: Templates are YAML files in a configurable directory
  (default: `mcp-server/templates/`).
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
  (chars / 4) — no tokenizer dependency.
- FR-4.4: When content exceeds a section's budget, it is truncated
  at a paragraph boundary with a "(truncated)" marker.

### FR-5: Output Format

- FR-5.1: Output is a single text string with markdown headers
  for each section.
- FR-5.2: Format:
  ```
  ## Conventions
  <repo context content>

  ## Architecture Decisions
  <relevant ADRs>

  ## Agent Memory
  <relevant memories and facts>

  ## Related Entities
  <graph context>
  ```
- FR-5.3: Empty sections are omitted from output.

## Non-Functional Requirements

### NFR-1: Performance

- `assemble_context` returns in under 500ms (parallel retrieval
  from all sources).
- Template loading is cached at startup (not read from disk on
  every call).

### NFR-2: Observability

- Audit log records each `assemble_context` call with: query,
  template used, sources hit, total tokens returned.
- Debug mode returns per-section token counts and which sections
  were truncated.

## Scope Boundaries

### In Scope

- `assemble_context` MCP tool.
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
- Existing `get_context`, `get_adrs`, `search_memory` logic
  (reused internally, not replaced).

## Success Criteria

1. A single `assemble_context` call replaces 3+ separate MCP
   tool calls for agents starting a task.
2. The "review" template produces measurably more relevant context
   for code review tasks than the generic `get_context` call.
3. Token budget is respected — output never exceeds the requested
   limit.
4. Adding or modifying a template requires only a YAML file
   change, no code changes.
5. Context assembly latency stays under 500ms despite hitting
   multiple sources.
