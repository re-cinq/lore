# Feature Specification: Temporal Fact Invalidation

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Temporal Fact Invalidation                   |
| Status         | Draft                                       |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P1 — High value, lower effort               |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

## Problem Statement

Facts in `memory.facts` are append-only. When an agent learns
something new that contradicts a previous fact, both the old and new
fact coexist in the database. Search returns stale facts alongside
current ones, polluting context and leading to incorrect agent
behavior.

Example: an agent stores "deployment uses Helm v3.12" on day 1.
On day 30, the team upgrades to Helm v3.15. A new fact is stored
but the old one remains active. Any search for "Helm version"
returns both, and the agent has no way to know which is current.

Memory versioning tracks history at the memory level (key-value
pairs) but does not propagate to the individual facts extracted
from those memories. Facts are treated as eternal truths.

## Vision

Every fact has a temporal validity window. When a new fact
contradicts an existing one, the old fact is automatically
invalidated with a `valid_to` timestamp. Search only returns
currently valid facts by default. The full fact timeline remains
available for historical queries.

## User Scenarios & Acceptance Criteria

### Scenario 1: Automatic Contradiction Detection

**Actor:** Any agent writing a memory

**Flow:**
1. Agent writes memory: "The CI pipeline uses GitHub Actions."
2. Fact extraction produces: "CI pipeline uses GitHub Actions."
3. Months later, agent writes: "We migrated CI to GitLab CI."
4. Fact extraction produces: "CI pipeline uses GitLab CI."
5. System detects high semantic similarity with existing fact
   about CI pipeline, marks old fact as `valid_to = now()`.
6. Search for "CI pipeline" returns only the GitLab CI fact.

**Acceptance Criteria:**
- Old fact's `valid_to` is set to the new fact's `valid_from`.
- Old fact is excluded from default search results.
- Old fact remains queryable with `include_invalidated=true`.
- New fact has `valid_from = now()` and `valid_to = NULL`.

### Scenario 2: Non-contradictory Facts Coexist

**Actor:** Any agent

**Flow:**
1. Agent stores: "The API uses REST for external clients."
2. Agent stores: "Internal services use gRPC."
3. Both facts are about APIs but are complementary, not
   contradictory.

**Acceptance Criteria:**
- Both facts remain valid (no invalidation).
- Contradiction detection uses a similarity threshold high enough
  to avoid false positives on related-but-different facts.
- Threshold is configurable (default 0.92 cosine similarity).

### Scenario 3: Historical Fact Timeline

**Actor:** Platform Engineer debugging agent behavior

**Flow:**
1. Engineer queries fact history for a specific topic.
2. System returns all facts (valid and invalidated) with their
   validity windows.

**Acceptance Criteria:**
- `valid_from` and `valid_to` form a non-overlapping timeline.
- Invalidated facts are clearly marked.
- Query supports filtering by time range.

## Functional Requirements

### FR-1: Temporal Columns on Facts

- FR-1.1: Add `valid_from TIMESTAMPTZ NOT NULL DEFAULT now()` to
  `memory.facts`.
- FR-1.2: Add `valid_to TIMESTAMPTZ` (NULL = currently valid) to
  `memory.facts`.
- FR-1.3: Add `invalidated_by UUID` (FK to the fact that replaced
  this one) to `memory.facts`.
- FR-1.4: Existing facts get `valid_from = created_at`,
  `valid_to = NULL` during migration.

### FR-2: Contradiction Detection on Write

- FR-2.1: After extracting facts from a new memory, embed each
  new fact and search existing valid facts for high-similarity
  matches (cosine similarity >= threshold).
- FR-2.2: For each match above threshold, set `valid_to = now()`
  and `invalidated_by = new_fact_id` on the old fact.
- FR-2.3: Threshold configurable via `LORE_FACT_SIMILARITY_THRESHOLD`
  env var (default: 0.92).
- FR-2.4: Contradiction detection runs inline during fact
  extraction (same async pipeline as today). Not a separate step.
- FR-2.5: If contradiction detection fails (embedding service
  down), the new fact is stored normally. Old facts are NOT
  invalidated. Fail-open — never block writes.

### FR-3: Temporal-Aware Search

- FR-3.1: `search_memory` and all fact queries filter to
  `valid_to IS NULL` by default (only current facts).
- FR-3.2: New optional parameter `include_invalidated: boolean`
  (default false) to include historical facts.
- FR-3.3: Search results include `valid_from` timestamp on fact
  results.

### FR-4: Monitoring

- FR-4.1: `agent_stats` includes count of invalidated facts.
- FR-4.2: Audit log records invalidation events with old and
  new fact IDs.

## Non-Functional Requirements

### NFR-1: Performance

- Contradiction detection adds < 200ms to the fact extraction
  pipeline (one vector search per new fact, limited to top 5
  matches).
- Search performance unchanged (filtering on `valid_to IS NULL`
  uses a partial index).

### NFR-2: Data Integrity

- Invalidation is atomic: old fact's `valid_to` and new fact's
  insert happen in the same transaction.
- No fact can have `valid_to` set without `invalidated_by`.

## Scope Boundaries

### In Scope

- Schema migration for `memory.facts`.
- Contradiction detection in `facts.ts` extraction pipeline.
- Search filter updates in `memory-search.ts`.
- Stats update in MCP tools.

### Out of Scope

- Manual fact invalidation via MCP tool (future enhancement).
- Cross-agent fact invalidation (facts are already agent-scoped
  via their parent memory).
- Invalidation of facts in shared pools (addressed separately).

## Dependencies

- Existing `memory.facts` table with embeddings.
- Vertex AI text-embedding-005 for fact embeddings (already in
  use).

## Data Model Changes

```sql
ALTER TABLE memory.facts
  ADD COLUMN valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN valid_to TIMESTAMPTZ,
  ADD COLUMN invalidated_by UUID REFERENCES memory.facts(id);

-- Backfill existing facts
UPDATE memory.facts SET valid_from = created_at WHERE valid_from = now();

-- Partial index for active facts (search performance)
CREATE INDEX facts_active_embedding_idx
  ON memory.facts USING hnsw (embedding vector_cosine_ops)
  WHERE valid_to IS NULL;
```

## Success Criteria

1. A contradictory fact automatically invalidates its predecessor
   within the same write operation.
2. Search returns only currently valid facts by default.
3. Zero increase in search latency for the common case.
4. Historical fact timeline is queryable for debugging.
5. No write failures due to contradiction detection — fail-open.
