# Feature Specification: Live Knowledge Graph

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Live Knowledge Graph                        |
| Status         | Draft                                       |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P2 — Higher value, higher effort            |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

## Problem Statement

Lore's knowledge graph (`graphrag/graph.json`) is a static file
built offline by a batch process. The code states it requires
"3+ months of accumulated content" before the graph is useful.
This means:

1. **Cold start**: New repos have no graph. Teams that just
   onboarded Lore get zero graph benefits.
2. **Staleness**: The graph reflects the codebase as of the last
   batch run, not current reality. A major refactor yesterday
   won't appear until the next nightly build.
3. **No memory integration**: Facts and memories are stored in
   PostgreSQL. The graph is a separate JSON file. There's no
   connection between what agents remember and what the graph
   knows.

Zep solves this with a live graph that updates incrementally as
episodes arrive. Every new piece of data triggers entity extraction
and graph edge upserts in real-time.

## Vision

Replace the static file-based graph with an incremental, Postgres-
backed knowledge graph that updates on every `write_memory` and
`write_episode` call. Entity extraction runs as part of the
ingestion pipeline. The graph is useful from day one — no
accumulation period required.

## User Scenarios & Acceptance Criteria

### Scenario 1: Immediate Graph Population

**Actor:** Team onboarding a new repo

**Flow:**
1. Repo is onboarded to Lore (CLAUDE.md, ADRs ingested).
2. First ingestion creates episodes from the repo content.
3. Entity extraction runs on each episode: identifies services,
   teams, technologies, concepts.
4. Graph edges connect entities: "service-A depends-on postgres",
   "team-backend owns service-A".
5. An agent queries the graph for "what depends on postgres?" and
   gets results immediately.

**Acceptance Criteria:**
- Graph is populated on first ingestion, not after 3 months.
- Entities and relationships are queryable via MCP tool within
  seconds of ingestion.
- No manual graph build step required.

### Scenario 2: Incremental Graph Updates

**Actor:** Agent writing a memory or episode

**Flow:**
1. Agent stores: "We migrated the auth service from Express to
   Hono."
2. Entity extraction identifies: `auth-service`, `Express`, `Hono`.
3. Graph updates: `auth-service --uses--> Express` gets
   `valid_to = now()`, `auth-service --uses--> Hono` is added.
4. Query for "what framework does auth-service use?" returns Hono.

**Acceptance Criteria:**
- Graph edges have temporal validity (mirrors fact invalidation).
- New writes update the graph incrementally (no full rebuild).
- Old relationships are invalidated, not deleted.

### Scenario 3: Graph-Augmented Search

**Actor:** Any agent

**Flow:**
1. Agent searches for "database performance."
2. System finds facts about database performance AND follows
   graph edges to find related entities (the Postgres service,
   teams that own it, related ADRs).
3. Results include both direct matches and graph-traversal
   results.

**Acceptance Criteria:**
- Search optionally follows 1-hop graph relationships.
- Graph-augmented results are clearly marked.
- Agent can opt out of graph augmentation for simple queries.

## Functional Requirements

### FR-1: Graph Schema in PostgreSQL

- FR-1.1: New table `memory.entities` stores nodes.
  Fields: `id`, `name`, `entity_type` (service, team, technology,
  concept, person), `properties` (JSONB), `repo` (optional scope),
  `created_at`, `updated_at`.
- FR-1.2: New table `memory.edges` stores relationships.
  Fields: `id`, `source_id` (FK entities), `target_id`
  (FK entities), `relation_type` (uses, owns, depends-on,
  replaced-by, etc.), `properties` (JSONB), `valid_from`,
  `valid_to`, `source_episode_id` / `source_memory_id`
  (provenance), `created_at`.
- FR-1.3: Entity deduplication by `(name, entity_type, repo)`.
  Upserting an entity with the same key updates properties.
- FR-1.4: Edge deduplication by
  `(source_id, target_id, relation_type)` where `valid_to IS NULL`.

### FR-2: Entity Extraction Pipeline

- FR-2.1: After fact extraction, run entity extraction on the
  same text using the same LLM call (extend the extraction prompt
  to also return entities and relationships).
- FR-2.2: Output format: list of `{name, type}` entities and
  `{source, target, relation}` edges.
- FR-2.3: Entity names are normalized (lowercase, trimmed) for
  deduplication.
- FR-2.4: If entity extraction fails, facts are still stored.
  Graph update is best-effort.

### FR-3: Temporal Edge Invalidation

- FR-3.1: When a new edge contradicts an existing one (same
  source + relation type but different target), the old edge
  gets `valid_to = now()`.
- FR-3.2: Example: `auth-service --uses--> Express` is
  invalidated when `auth-service --uses--> Hono` is added.
- FR-3.3: Non-contradictory edges (different relation types, or
  entities that can have multiple targets) coexist.

### FR-4: Graph Query MCP Tool

- FR-4.1: `query_graph(entity?, relation_type?, depth?)` returns
  entities and their relationships.
- FR-4.2: `depth` controls traversal hops (default 1, max 3).
- FR-4.3: Results filtered to `valid_to IS NULL` by default.
- FR-4.4: Optional `repo` scope parameter.

### FR-5: Graph-Augmented Search

- FR-5.1: `search_memory` gains optional `graph_augment: boolean`
  parameter (default false).
- FR-5.2: When enabled, search results are enriched with 1-hop
  graph neighbors of matched entities.
- FR-5.3: Graph-augmented results have lower RRF weight than
  direct matches.

### FR-6: Migration from Static Graph

- FR-6.1: Import existing `graphrag/graph.json` into the new
  tables (one-time migration script).
- FR-6.2: Remove dependency on static graph file after migration.
- FR-6.3: Deprecate offline graph build process.

## Non-Functional Requirements

### NFR-1: Performance

- Entity extraction adds < 500ms to the ingestion pipeline.
- Graph queries return in under 200ms for depth <= 2.
- Graph augmentation adds < 100ms to search.

### NFR-2: Scale

- Support up to 100,000 entities and 500,000 edges per repo.
- Entity deduplication prevents unbounded growth.

## Scope Boundaries

### In Scope

- `memory.entities` and `memory.edges` tables.
- Entity extraction in the fact extraction pipeline.
- Temporal edge invalidation.
- `query_graph` MCP tool.
- Optional graph augmentation in `search_memory`.
- Migration from `graphrag/graph.json`.

### Out of Scope

- Graph visualization in the web UI (follow-up).
- Cross-repo graph federation.
- Graph-based reasoning (multi-hop inference).
- Per-team graph isolation (natural extension of existing
  schema-per-team, not needed now).

## Dependencies

- Temporal fact invalidation (same temporal validity pattern on
  graph edges).
- Episode ingestion (episodes are the primary ingestion trigger).
- Existing fact extraction pipeline (`facts.ts`).

## Data Model Changes

```sql
CREATE TABLE IF NOT EXISTS memory.entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  properties   JSONB DEFAULT '{}',
  repo         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entities_name_type_repo_idx
  ON memory.entities (name, entity_type, COALESCE(repo, ''));

CREATE TABLE IF NOT EXISTS memory.edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID NOT NULL REFERENCES memory.entities(id),
  target_id         UUID NOT NULL REFERENCES memory.entities(id),
  relation_type     TEXT NOT NULL,
  properties        JSONB DEFAULT '{}',
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to          TIMESTAMPTZ,
  source_episode_id UUID REFERENCES memory.episodes(id),
  source_memory_id  UUID REFERENCES memory.memories(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX edges_source_idx ON memory.edges (source_id)
  WHERE valid_to IS NULL;
CREATE INDEX edges_target_idx ON memory.edges (target_id)
  WHERE valid_to IS NULL;
CREATE INDEX edges_relation_idx
  ON memory.edges (source_id, relation_type)
  WHERE valid_to IS NULL;
```

## Success Criteria

1. A newly onboarded repo has a populated knowledge graph within
   minutes of first ingestion, not months.
2. Writing a memory or episode that mentions entities automatically
   updates the graph without a separate build step.
3. Contradictory relationships are automatically invalidated
   (temporal edges).
4. `query_graph` returns useful results for "what uses X?" and
   "what does team Y own?" queries.
5. Graph-augmented search surfaces related context that pure
   vector search misses.
