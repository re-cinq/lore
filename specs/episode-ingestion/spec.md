# Feature Specification: Passive Episode Ingestion

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Passive Episode Ingestion                   |
| Status         | Draft                                       |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P1 — High value, lower effort               |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

## Problem Statement

Lore's memory system requires agents to explicitly call
`write_memory` with a curated key-value pair. This is a deliberate,
structured operation. If an agent doesn't decide something is worth
remembering, it's lost.

This misses the most valuable signal: the messy, unstructured
observations that happen during agent work — conversation turns,
code review comments, debugging sessions, CI failures, PR
discussions. These are rich with context but no agent is going to
manually extract and store each insight.

Zep's insight: make the ingestion unit an **episode** — any
time-stamped blob of data that flows through a pipeline
automatically. The agent dumps raw text; the system does the rest.

## Vision

A new `write_episode` MCP tool that accepts raw, unstructured text
and automatically runs the full ingestion pipeline: store the
episode, extract facts (with temporal validity), and optionally
update the knowledge graph. Agents write episodes as a low-effort
side effect of their work. The system handles curation.

## User Scenarios & Acceptance Criteria

### Scenario 1: Agent Captures a Session Summary

**Actor:** Claude Code session (via PostToolUse hook or manual)

**Flow:**
1. At session end, agent calls `write_episode` with a summary of
   what happened: decisions made, files changed, problems hit.
2. System stores the episode and extracts facts.
3. In a later session, `search_memory` returns relevant facts from
   that episode.

**Acceptance Criteria:**
- Episode is stored with timestamp, agent ID, and source tag.
- Facts are extracted and individually searchable.
- Facts have `valid_from` set to episode timestamp.
- The agent did not need to decide what was important — the system
  extracted it.

### Scenario 2: Code Review Ingestion

**Actor:** Review agent or webhook handler

**Flow:**
1. A PR review is posted with inline comments.
2. The review text is sent to `write_episode` with
   `source: "pr-review"` and `ref: "owner/repo#42"`.
3. Facts like "reviewer prefers explicit error types over string
   errors in Go code" are extracted and searchable.

**Acceptance Criteria:**
- Episode preserves the source reference (PR number, repo).
- Extracted facts are linked to the episode.
- Facts are searchable across agents (shared context).

### Scenario 3: Bulk Episode Ingestion

**Actor:** Nightly ingestion job

**Flow:**
1. Ingestion job processes a day's worth of PR comments, CI logs,
   and commit messages.
2. Each item is written as an episode via batch API.
3. Fact extraction runs asynchronously for all episodes.

**Acceptance Criteria:**
- Batch ingestion of 100+ episodes completes without blocking.
- Fact extraction is queued and processed in the background.
- Episodes with the same content are deduplicated (idempotent).

### Scenario 4: Episode Search

**Actor:** Any agent

**Flow:**
1. Agent searches memories with a query.
2. Results include both explicit memories and facts extracted
   from episodes.
3. Results indicate whether the source was a memory or an episode.

**Acceptance Criteria:**
- Episode-derived facts appear in `search_memory` results.
- Results include `source: "episode"` to distinguish from explicit
  memories.
- Episode metadata (source tag, ref) is available on results.

## Functional Requirements

### FR-1: Episode Storage

- FR-1.1: New table `memory.episodes` stores raw episode data.
- FR-1.2: Fields: `id`, `agent_id`, `content` (text),
  `source` (tag: "session", "pr-review", "ci", "manual"),
  `ref` (optional external reference like "owner/repo#42"),
  `embedding` (vector), `created_at`.
- FR-1.3: Episodes are immutable once written. No updates.
- FR-1.4: Content deduplication via content hash — writing the
  same content twice for the same agent is a no-op.

### FR-2: write_episode MCP Tool

- FR-2.1: `write_episode(content, source?, ref?, agent_id?)`
  stores an episode and triggers the ingestion pipeline.
- FR-2.2: Returns immediately after storing the episode.
  Fact extraction runs asynchronously.
- FR-2.3: The tool validates that `content` is non-empty and
  under 50,000 characters.
- FR-2.4: `source` defaults to "manual" if not provided.

### FR-3: Episode Fact Extraction

- FR-3.1: Reuses the existing `extractFacts` pipeline from
  `facts.ts`.
- FR-3.2: Facts extracted from episodes are stored in
  `memory.facts` with `episode_id` (new FK) instead of
  `memory_id`.
- FR-3.3: Contradiction detection (from temporal-fact-invalidation
  spec) applies to episode-derived facts identically.
- FR-3.4: If extraction fails, the episode is stored without facts.
  A background retry job picks up episodes with zero facts.

### FR-4: Search Integration

- FR-4.1: `search_memory` queries episode-derived facts alongside
  memory-derived facts (extend existing RRF merge).
- FR-4.2: Results from episodes include `source: "episode"` and
  the episode's `ref` field.
- FR-4.3: New optional `source` filter on `search_memory` to
  search only episodes or only memories.

### FR-5: Episode Listing

- FR-5.1: `list_episodes(agent_id?, source?, limit?)` returns
  recent episodes for an agent.
- FR-5.2: Episodes include their extracted fact count.

## Non-Functional Requirements

### NFR-1: Performance

- `write_episode` returns in under 100ms (async extraction).
- Episode fact extraction completes within 30 seconds.
- Search latency unchanged (facts are facts regardless of source).

### NFR-2: Storage

- Episodes are stored as raw text. No compression.
- Content hash index prevents duplicates.
- Facts reference their source episode for provenance.

## Scope Boundaries

### In Scope

- `memory.episodes` table and schema migration.
- `write_episode` and `list_episodes` MCP tools.
- Fact extraction pipeline extension.
- Search integration.

### Out of Scope

- Automatic episode creation from hooks (agents call explicitly
  for now — hook integration is a follow-up).
- Episode summarization (episodes are stored as-is).
- Streaming ingestion (batch via `write_episode` calls).

## Dependencies

- Temporal fact invalidation spec (contradiction detection on
  episode-derived facts).
- Existing fact extraction pipeline (`facts.ts`).
- Existing search infrastructure (`memory-search.ts`).

## Data Model Changes

```sql
CREATE TABLE IF NOT EXISTS memory.episodes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual',
  ref          TEXT,
  embedding    VECTOR(768),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX episodes_agent_hash_idx
  ON memory.episodes (agent_id, content_hash);
CREATE INDEX episodes_agent_source_idx
  ON memory.episodes (agent_id, source, created_at DESC);
CREATE INDEX episodes_embedding_idx
  ON memory.episodes USING hnsw (embedding vector_cosine_ops);

-- Extend facts to support episode source
ALTER TABLE memory.facts
  ADD COLUMN episode_id UUID REFERENCES memory.episodes(id);

-- Allow facts without memory_id (episode-only facts)
ALTER TABLE memory.facts
  ALTER COLUMN memory_id DROP NOT NULL;

-- Constraint: fact must have either memory_id or episode_id
ALTER TABLE memory.facts
  ADD CONSTRAINT facts_source_check
  CHECK (memory_id IS NOT NULL OR episode_id IS NOT NULL);
```

## Success Criteria

1. An agent calls `write_episode` with raw text and facts are
   automatically extracted and searchable within 30 seconds.
2. PR review comments ingested as episodes produce searchable
   coding preferences and patterns.
3. `search_memory` returns episode-derived facts transparently
   alongside memory-derived facts.
4. Duplicate episode writes are idempotent.
5. No increase in search latency from adding episode-derived
   facts to the result set.
