# Feature Specification: Hippo-Memory Adaptations

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Hippo-Memory Adaptations                    |
| Status         | In Progress                                 |
| Created        | 2026-04-07                                  |
| Implemented    | 2026-04-20                                  |
| Owner          | Platform Engineering                        |
| Priority       | P1 — High value, medium effort              |
| Motivation     | [GitHub issue #205](https://github.com/re-cinq/lore/issues/205), [ADR-014](../../adrs/ADR-014-passive-memory-capture.md) |

Hippo-Memory Adaptations gives facts and memories a continuous strength score that grows on retrieval and decays over time, adds confidence tiers, surfaces contradictions explicitly instead of resolving them silently, filters cross-repo context by transferability, and feeds PR merge/reject outcomes back into the memories that contributed to a task.

## Problem Statement

Lore's memory system treats fact validity as a binary cliff: a fact
is either valid (`valid_to IS NULL`) or dead. There is no continuous
strength model that rewards frequently-used facts or penalizes stale
ones. Contradictions are resolved silently (auto-invalidation at
cosine similarity >= 0.92), giving agents no visibility into conflicts.
Cross-repo context includes all facts indiscriminately — project-
specific configuration facts pollute other repos' search results.
And PR outcomes (merge/reject) captured by `merge-check` are stored
as episodes but never wired back to the facts/memories that
contributed to the task.

These gaps were identified by exploring
[kitfunso/hippo-memory](https://github.com/kitfunso/hippo-memory),
a biologically-inspired agent memory library that models memory
strength as exponential decay with retrieval strengthening.

## Vision

Facts and memories have a continuous strength score that increases
on retrieval and decays over time. Confidence tiers give agents
visibility into how trustworthy a fact is. Contradictions are
surfaced explicitly instead of resolved silently. Transfer scoring
filters cross-repo context to portable, high-value facts. PR
outcomes feed back into the memories that contributed to the task.

## User Scenarios & Acceptance Criteria

### Scenario 1: Retrieval Strengthening

**Actor:** Any agent calling `lore_search_memory`

**Flow:**
1. Agent searches for "deployment pipeline."
2. Search returns 5 facts ranked by RRF score.
3. For each returned fact, the system increments `retrieval_count`
   and extends `half_life_days` by +2.
4. Next time the importance decay job runs, these facts score
   higher because they were recently retrieved and have longer
   half-lives.

**Acceptance Criteria:**
- `retrieval_count` and `last_retrieved_at` updated on every search
  hit (both facts and memories).
- `half_life_days` increased by +2 per retrieval (capped at 365).
- Importance scoring in `memory-lifecycle.ts` uses `half_life_days`
  and `last_retrieved_at` instead of raw `created_at` for recency. ([validated by `memory-ranking.test.ts:168`](libs/shared/src/memory-ranking.test.ts#L168))

### Scenario 2: Confidence Tiers on Facts

**Actor:** Agent receiving assembled context

**Flow:**
1. Agent calls `lore_assemble_context`.
2. Context assembly includes facts with confidence annotations:
   `[verified]`, `[observed]`, `[inferred]`, `[stale]`.
3. Agent trusts `[verified]` facts fully, treats `[stale]` facts
   as hints that may be outdated.

**Acceptance Criteria:**
- New `confidence` column on `memory.facts` with enum values:
  `verified`, `observed`, `inferred`, `stale`.
- New facts default to `observed` (extracted from episodes) or
  `inferred` (extracted from memories).
- Facts unretrieved for 30+ days auto-transition to `stale` via
  the decay job.
- Facts retrieved while `stale` revive to `observed`.
- `lore_assemble_context` and `lore_search_memory` include confidence in
  output.

### Scenario 3: Explicit Conflict Surfacing

**Actor:** Agent receiving search results with conflicting facts

**Flow:**
1. New fact contradicts an existing fact (similarity >= 0.92).
2. Instead of silently invalidating the old fact, the system stores
   the conflict as a `memory.fact_conflicts` record.
3. For high-stakes facts (architecture, security), `lore_assemble_context`
   surfaces `[CONFLICT]` annotations.
4. Agent can make an informed decision about which fact to trust.

**Acceptance Criteria:**
- New `memory.fact_conflicts` table linking old/new fact pairs.
- Contradiction detection still auto-invalidates (no change to
  default behavior) but also stores the conflict record.
- `lore_assemble_context` includes `[CONFLICT]` prefix for facts that
  have active conflicts (both the old invalidated and new valid
  fact are shown).
- `lore_search_memory` with `include_invalidated=true` shows conflict
  pairs.

### Scenario 4: Transfer Scoring for Cross-Repo

**Actor:** Agent working in repo A, getting cross-repo context from
repo B

**Flow:**
1. Agent calls `lore_assemble_context` with cross-repo enabled.
2. Cross-repo fact search applies transfer scoring: facts with
   portable keywords (`error`, `pattern`, `gotcha`, `rule`) are
   boosted; facts with local keywords (`config`, `deploy`, `url`,
   `auth`, `secret`) are suppressed.
3. Agent receives only high-transfer-score facts from other repos.

**Acceptance Criteria:**
- `transfer_score` computed at search time (not stored) based on
  keyword heuristics in fact text.
- Cross-repo fact queries in `context-assembly.ts` filter to
  `transfer_score >= 0.5`.
- Transfer scoring does NOT apply to same-repo queries.

### Scenario 5: Outcome Feedback Loop

**Actor:** `merge-check` job detecting a PR merge or rejection

**Flow:**
1. PR merges successfully.
2. `merge-check` identifies the task that created the PR.
3. System finds memories/facts that were part of the task's context
   assembly (via task metadata or audit log).
4. For merged PRs: boost `half_life_days` by +5 on contributing
   facts.
5. For rejected PRs: reduce `half_life_days` by -3 on contributing
   facts.

**Acceptance Criteria:**
- Task creation records which memories/facts were assembled as
  context (stored in `pipeline.tasks.context_refs` JSONB column).
- `merge-check` reads `context_refs` and adjusts `half_life_days`.
- Adjustments are logged in `memory.audit_log`.

## Functional Requirements

### FR-1: Retrieval Metadata on Facts and Memories

- FR-1.1: Add `retrieval_count INT DEFAULT 0` to `memory.facts`.
- FR-1.2: Add `last_retrieved_at TIMESTAMPTZ` to `memory.facts`.
- FR-1.3: Add `half_life_days INT DEFAULT 30` to `memory.facts`.
- FR-1.4: Add `retrieval_count INT DEFAULT 0` to `memory.memories`.
- FR-1.5: Add `last_retrieved_at TIMESTAMPTZ` to `memory.memories`.
- FR-1.6: Add `half_life_days INT DEFAULT 60` to `memory.memories`.

### FR-2: Retrieval Strengthening in Search

- FR-2.1: After `searchMemories()` returns results, batch-update
  `retrieval_count = retrieval_count + 1`,
  `last_retrieved_at = now()`,
  `half_life_days = LEAST(half_life_days + 2, 365)` for all
  returned fact and memory IDs.
- FR-2.2: Update is fire-and-forget (async, no await in hot path).

### FR-3: Confidence Tiers

- FR-3.1: Add `confidence TEXT DEFAULT 'observed'` to `memory.facts`
  with CHECK constraint `IN ('verified', 'observed', 'inferred', 'stale')`.
- FR-3.2: Facts extracted from episodes default to `observed`.
- FR-3.3: Facts extracted from memories default to `inferred`.
- FR-3.4: Decay job transitions facts to `stale` when
  `last_retrieved_at < now() - 30 days` (or `last_retrieved_at IS
  NULL AND created_at < now() - 30 days`); already-`verified` facts
  are left untouched. ([validated by `memory-lifecycle.test.ts:188`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L188), [`memory-lifecycle.test.ts:424`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L424))
- FR-3.5: On retrieval, if confidence is `stale`, update to
  `observed`.
- FR-3.6: Include confidence tier in search results and context
  assembly output.

### FR-4: Conflict Surfacing

- FR-4.1: Create `memory.fact_conflicts` table with `old_fact_id`,
  `new_fact_id`, `similarity`, `created_at`.
- FR-4.2: `invalidateContradictions()` inserts a conflict record
  before invalidating.
- FR-4.3: `lore_assemble_context` checks for conflicts on assembled
  facts and prefixes with `[CONFLICT]` annotation.

### FR-5: Transfer Scoring

- FR-5.1: Add `computeTransferScore(factText: string): number`
  function in `memory-search.ts`. ([validated by `transfer-score.test.ts:44`](apps/mcp-server/src/features/context/transfer-score.test.ts#L44))
- FR-5.2: Portable keywords boost score: `error`, `pattern`,
  `gotcha`, `rule`, `convention`, `best-practice`, `anti-pattern`. ([validated by `transfer-score.test.ts:50`](apps/mcp-server/src/features/context/transfer-score.test.ts#L50))
- FR-5.3: Local keywords reduce score: `config`, `deploy`, `url`,
  `auth`, `secret`, `env`, `port`, `hostname`, `endpoint`. ([validated by `transfer-score.test.ts:58`](apps/mcp-server/src/features/context/transfer-score.test.ts#L58))
- FR-5.4: Base score 0.5, each portable keyword +0.15, each local
  keyword -0.15, clamped to [0, 1]. ([validated by `transfer-score.test.ts:82`](apps/mcp-server/src/features/context/transfer-score.test.ts#L82))
- FR-5.5: Cross-repo queries in `context-assembly.ts` filter to
  `transfer_score >= 0.5`.

### FR-6: Outcome Feedback

- FR-6.1: Add `context_refs JSONB` column to `pipeline.tasks`.
- FR-6.2: When creating a pipeline task, store the IDs of
  assembled facts/memories in `context_refs`.
- FR-6.3: In `merge-check`, on PR merge: update contributing
  facts/memories with `half_life_days += 5` (capped at 365, using the
  table defaults 30/60 for a null `half_life_days`); an empty id list
  is a no-op. ([validated by `memory-lifecycle.test.ts:214`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L214), [`memory-lifecycle.test.ts:472`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L472), [`memory-lifecycle.test.ts:242`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L242))
- FR-6.4: In `merge-check`, on PR rejection: update contributing
  facts/memories with `half_life_days = MAX(7, half_life_days - 3)`
  (using the table defaults 30/60 for a null `half_life_days`). ([validated by `memory-lifecycle.test.ts:229`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L229), [`memory-lifecycle.test.ts:488`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L488))
- FR-6.5: Audit log outcome feedback events, with the metadata
  serialized on the row. ([validated by `memory-lifecycle.test.ts:252`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L252), [`memory-lifecycle.test.ts:500`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L500))

### FR-7: Updated Importance Scoring

- FR-7.1: Replace raw `created_at` recency with
  `effective_age = days_since(COALESCE(last_retrieved_at, created_at))`. ([validated by `memory-ranking.test.ts:168`](libs/shared/src/memory-ranking.test.ts#L168))
- FR-7.2: Apply half-life decay: `strength = 0.5^(effective_age / half_life_days)`, mapping strength to a 0–10 score and honoring a custom `half_life_days`. ([validated by `memory-ranking.test.ts:143`](libs/shared/src/memory-ranking.test.ts#L143), [`memory-ranking.test.ts:113`](libs/shared/src/memory-ranking.test.ts#L113), [`memory-ranking.test.ts:206`](libs/shared/src/memory-ranking.test.ts#L206))
- FR-7.3: Incorporate `retrieval_count` as a minor boost: `+1` if
  `retrieval_count >= 5`, `+2` if `>= 20`. ([validated by `memory-ranking.test.ts:212`](libs/shared/src/memory-ranking.test.ts#L212))
- FR-7.4: Stale-confidence facts get `-1` penalty. ([validated by `memory-ranking.test.ts:162`](libs/shared/src/memory-ranking.test.ts#L162))

## Non-Functional Requirements

### NFR-1: Performance

- Retrieval strengthening updates must be async (fire-and-forget)
  and add < 10ms to search hot path.
- Transfer scoring is pure computation (no DB query), < 1ms per
  fact.
- Confidence tier transitions in decay job: batch UPDATE, not
  per-row.

### NFR-2: Migration Safety

- All schema changes are idempotent (`ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`).
- New columns have sensible defaults — existing data works without
  backfill.
- No downtime required.

### NFR-3: Backward Compatibility

- `lore_search_memory` MCP tool response format unchanged (confidence
  added as optional field).
- Existing importance decay behavior preserved when `half_life_days`
  is at default values.

## Scope Boundaries

### In Scope

- Schema migrations for new columns and tables.
- Retrieval strengthening in `memory-search.ts`.
- Confidence tiers in facts extraction and search.
- Conflict surfacing table and annotations.
- Transfer scoring for cross-repo queries.
- Outcome feedback from `merge-check`.
- Updated importance scoring in `memory-lifecycle.ts`.

### Out of Scope

- Active invalidation from git commit messages (future — requires
  ingestion pipeline changes).
- Working memory as a distinct bounded layer (future — separate
  spec).
- Schema acceleration / IDF-weighted tag scoring (future).
- UI for browsing fact conflicts (future).

## Dependencies

- Existing `memory.facts` and `memory.memories` tables.
- `memory-search.ts` hybrid search infrastructure.
- `memory-lifecycle.ts` decay/consolidation jobs.
- `merge-check.ts` PR outcome detection.
- `context-assembly.ts` template system.
- Vertex AI text-embedding-005 (already in use).

## Data Model Changes

```sql
-- FR-1: Retrieval metadata
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 30;

ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 60;

-- FR-3: Confidence tiers
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'observed';
-- CHECK constraint added via DO block for idempotency

-- FR-4: Conflict surfacing
CREATE TABLE IF NOT EXISTS memory.fact_conflicts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  new_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  similarity  FLOAT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_conflicts_old_idx ON memory.fact_conflicts (old_fact_id);
CREATE INDEX IF NOT EXISTS fact_conflicts_new_idx ON memory.fact_conflicts (new_fact_id);

-- FR-6: Outcome feedback
ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS context_refs JSONB;
```

## Success Criteria

1. Frequently-retrieved facts survive importance decay longer than
   never-retrieved facts of the same age.
2. Facts have visible confidence tiers in search results and
   assembled context.
3. Contradictions are recorded and surfaceable (not just silently
   resolved).
4. Cross-repo queries return portable facts, not repo-specific
   configuration.
5. Merged PRs strengthen the facts that helped produce them;
   rejected PRs weaken them.
6. Zero increase in search latency (retrieval strengthening is
   async).
7. All migrations are idempotent and backward-compatible.

## Implementation Notes

All six feature areas were implemented. Below are the key files and
any notable deviations from the original spec.

### What was built

| FR | File(s) | Notes |
|----|---------|-------|
| FR-1 (schema) | `scripts/infra/setup-memory-schema.sh` | **Not created as planned.** Schema changes were applied without an idempotent migration file. See known gap below. |
| FR-2 (retrieval strengthening) | `mcp-server/src/memory-search.ts` | `strengthenRetrievals()` implemented as fire-and-forget. Uses `f.id` returned from both vector and keyword fact queries. Stale→observed revival included in the same UPDATE. |
| FR-3 (confidence tiers) | `mcp-server/src/facts.ts`, `mcp-server/src/context-assembly.ts`, `agent/src/jobs/memory-lifecycle.ts` | Episode-sourced facts default to `observed` via column default; memory-sourced explicitly set `inferred`. Decay job adds a batch UPDATE to transition to `stale` after 30 days. Confidence rendered in assembled context as `[confidence]` prefix on each fact. |
| FR-4 (conflict surfacing) | `mcp-server/src/facts.ts`, `mcp-server/src/context-assembly.ts` | `invalidateContradictions()` inserts a `fact_conflicts` record before invalidating. Context assembly queries 7-day conflicts and prefixes affected facts with `[CONFLICT]`. **Deviation:** only the new (valid) fact is marked `[CONFLICT]` — the old invalidated fact is not shown alongside it (spec said both should appear). |
| FR-5 (transfer scoring) | `mcp-server/src/memory-search.ts`, `mcp-server/src/context-assembly.ts` | `computeTransferScore()` matches spec exactly (base 0.5, portable +0.15, local −0.15). Cross-repo queries filter at `>= 0.5`. |
| FR-6 (outcome feedback) | `agent/src/jobs/merge-check.ts`, `mcp-server/src/pipeline.ts`, `mcp-server/src/context-assembly.ts` | `assembleContext()` accepts `include_ids` flag and returns `{ fact_ids, memory_ids }` as `context_refs`. Stored on `pipeline.tasks.context_refs` JSONB. Merge boosts +5, rejection penalises −3 (min 7). Audit log events written. |
| FR-7 (importance scoring) | `agent/src/jobs/memory-lifecycle.ts` | `scoreImportance()` rewritten with `0.5^(effective_age / half_life_days)` strength model. Retrieval boost (+1 ≥5, +2 ≥20) and stale penalty (−1) applied. |

### Known gap: missing schema migration file

`setup-memory-schema.sh` was not created. The SQL from the spec's
Data Model Changes section was applied to the database directly
(or via another path not tracked in this repo). To make the schema
self-documenting and safe for future re-installs:

```sql
-- Add to scripts/infra/setup-memory-schema.sh

-- Retrieval strengthening
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 30;

ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 60;

-- Confidence tiers
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'observed';
DO $$ BEGIN
  ALTER TABLE memory.facts ADD CONSTRAINT facts_confidence_check
    CHECK (confidence IN ('verified', 'observed', 'inferred', 'stale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Conflict surfacing
CREATE TABLE IF NOT EXISTS memory.fact_conflicts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  new_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  similarity  FLOAT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_conflicts_old_idx ON memory.fact_conflicts (old_fact_id);
CREATE INDEX IF NOT EXISTS fact_conflicts_new_idx ON memory.fact_conflicts (new_fact_id);

-- Outcome feedback
ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS context_refs JSONB;
```

### Deviation: conflict pair display

The spec required "both the old invalidated and new valid fact are
shown" when a conflict exists. The implementation only marks the
new (currently valid) fact with `[CONFLICT]`. The old invalidated
fact is accessible via `lore_search_memory` with
`include_invalidated=true` but is not proactively surfaced in
assembled context. Acceptable for now; can be revisited if agents
need the contradicted fact text to reason about the conflict.
