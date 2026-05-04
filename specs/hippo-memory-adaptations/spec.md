# Hippo Memory Adaptations — Implementation Spec

## Overview

This document specifies enhancements to the hippo memory system to support:
1. **Retrieval strengthening** — facts retrieved more often decay slower
2. **Confidence tiers** — distinguish verified, observed, inferred, and stale facts
3. **Conflict surfacing** — flag contradictory facts in context assembly
4. **Transfer scoring** — rank cross-repo memory by portability
5. **Outcome feedback** — boost/penalise facts based on merge outcomes
6. **Importance scoring** — weight facts by recency and retrieval frequency

## Data Model Changes

### New Columns

#### `memory.facts`
- `retrieval_count INT DEFAULT 0` — how many times this fact was returned in a search result
- `last_retrieved_at TIMESTAMPTZ` — when it was last included in assembled context
- `half_life_days INT DEFAULT 30` — decay rate; adjusted by outcome feedback (FR-5)
- `confidence TEXT DEFAULT 'observed'` — one of: `verified`, `observed`, `inferred`, `stale`
  - Constraint: `CHECK (confidence IN ('verified', 'observed', 'inferred', 'stale'))`

#### `memory.memories`
- `retrieval_count INT DEFAULT 0`
- `last_retrieved_at TIMESTAMPTZ`
- `half_life_days INT DEFAULT 60`

### New Tables

#### `memory.fact_conflicts`
Tracks contradictions detected during fact validation:

```sql
CREATE TABLE memory.fact_conflicts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  new_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  similarity  FLOAT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fact_conflicts_old_idx ON memory.fact_conflicts (old_fact_id);
CREATE INDEX fact_conflicts_new_idx ON memory.fact_conflicts (new_fact_id);
```

#### `pipeline.tasks` — new column
- `context_refs JSONB` — structured record of `{ fact_ids: UUID[], memory_ids: UUID[] }` passed to the agent

---

## Feature Requirements

### FR-1: Schema Migration
**Acceptance:** All hippo-memory columns and tables exist and are idempotent to re-apply.

**Implementation:** `scripts/infra/setup-memory-schema.sh` contains all ALTER and CREATE TABLE statements with `IF NOT EXISTS` guards.

**Status:** ✅ Implemented

---

### FR-2: Retrieval Strengthening
**Acceptance:** Each time a fact or memory is included in assembled context, increment its `retrieval_count` and update `last_retrieved_at`.

**Implementation:**
- `mcp-server/src/memory-search.ts` — `strengthenRetrievals(pool, fact_ids, memory_ids)` 
  - Called after `assembleContext()` returns
  - Executes two parallel UPDATE statements:
    ```sql
    UPDATE memory.facts SET retrieval_count = retrieval_count + 1, last_retrieved_at = now() WHERE id = ANY($1);
    UPDATE memory.memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = now() WHERE id = ANY($1);
    ```
  - Fire-and-forget (no await required in hot path)

---

### FR-3: Confidence Tiers
**Acceptance:** Facts have a `confidence` level. Episode facts default to `observed`; memory-sourced facts default to `inferred`. Facts older than 30 days without retrieval transition to `stale`. Context assembly prefixes each fact with `[confidence]`.

**Implementation:**
- `mcp-server/src/facts.ts` — when inserting a fact, set `confidence = 'observed'` (column default for episode facts)
- `mcp-server/src/facts.ts` — when upserting memory-sourced facts, set `confidence = 'inferred'`
- `agent/src/jobs/memory-lifecycle.ts` — `decayStaleMemory()` batch job:
  ```sql
  UPDATE memory.facts SET confidence = 'stale' WHERE last_retrieved_at < now() - '30 days'::interval AND confidence != 'stale';
  ```
- `mcp-server/src/context-assembly.ts` — when rendering facts, prefix with `[${fact.confidence}]`:
  ```
  [observed] User prefers dark mode
  [inferred] Project uses TypeScript
  [stale] Team size: 4 (needs refresh)
  ```

---

### FR-4: Conflict Surfacing
**Acceptance:** When a new fact contradicts an older fact, both are flagged in context. The system records the conflict for audit and learning.

**Implementation:**
- `mcp-server/src/facts.ts` — `invalidateContradictions(pool, new_fact_id, old_fact_ids)`:
  1. Insert row into `memory.fact_conflicts` for each pair
  2. Update old fact's `confidence = 'stale'`
  3. Write audit log entry
- `mcp-server/src/context-assembly.ts` — when assembling context:
  1. Query `fact_conflicts` for any conflicts involving returned facts (7-day window)
  2. Prefix conflicted facts with `[CONFLICT]`

**Deviation from spec:** Only the new (valid) fact is marked `[CONFLICT]` in the returned context. The old invalidated fact is not shown alongside it because it is already marked `stale` and filtered from most queries.

---

### FR-5: Transfer Scoring
**Acceptance:** Cross-repo facts are ranked by portability. A score ≥ 0.5 is required to include them.

**Implementation:**
- `mcp-server/src/memory-search.ts` — `computeTransferScore(fact, query_repo)`:
  ```
  base = 0.5
  if (fact is portable): score += 0.15
  if (fact is local-only): score -= 0.15
  return score
  ```
- `mcp-server/src/context-assembly.ts` — cross-repo queries filter at `transferScore >= 0.5`

---

### FR-6: Outcome Feedback
**Acceptance:** When a task completes (merged or rejected), the facts and memories used to assemble its context are rewarded or penalised via their `half_life_days`.

**Implementation:**
- `mcp-server/src/context-assembly.ts` — `assembleContext()` signature:
  ```typescript
  assembleContext(
    pool: Pool,
    query: string,
    template?: string,
    max_tokens?: number,
    repo?: string,
    include_episode_facts?: boolean,
    facts_only?: boolean,
    includeIds?: boolean  // NEW
  ): Promise<{
    text: string;
    sections: Section[];
    context_refs?: { fact_ids: UUID[]; memory_ids: UUID[] };  // NEW
  }>
  ```
  - When `includeIds: true`, return `context_refs` with lists of all `fact.id` and `memory.id` used
  
- `mcp-server/src/routes.ts` ~line 299 — memory search endpoint:
  ```typescript
  const result = await assembleContext(pool, query, template, 8000, repo || undefined, undefined, undefined, true);
  json(res, 200, {
    text: result.text || null,
    sections: result.sections,
    context_refs: result.context_refs  // NEW
  });
  ```

- `mcp-server/src/pipeline.ts` — `createTask()` signature:
  ```typescript
  createTask(
    pool: Pool,
    description: string,
    task_type: string,
    target_repo: string,
    priority: number,
    context: string,
    contextRefs?: { fact_ids: UUID[]; memory_ids: UUID[] }  // NEW
  ): Promise<Task>
  ```
  - Store `contextRefs` in `pipeline.tasks.context_refs` as JSONB
  
- `mcp-server/src/routes.ts` — `/api/task` POST handler:
  ```typescript
  const { description, task_type, target_repo, priority, context, context_refs } = parsed;  // NEW
  // ... 
  const task = await createTask(pool, description, task_type, target_repo, priority, context, context_refs);  // NEW param
  ```

- `agent/src/jobs/merge-check.ts` — outcome feedback job:
  ```typescript
  async function processMergeOutcome(pool: Pool, merge_result: MergeResult) {
    const task = await getTask(pool, merge_result.task_id);
    if (!task.context_refs) return;  // Nothing to update
    
    const delta = merge_result.merged ? +5 : -3;  // Merge boost, reject penalty
    const fact_ids = task.context_refs.fact_ids || [];
    const memory_ids = task.context_refs.memory_ids || [];
    
    // Adjust half_life for used facts/memories
    await pool.query(
      `UPDATE memory.facts SET half_life_days = MAX(7, half_life_days + $1) WHERE id = ANY($2)`,
      [delta, fact_ids]
    );
    await pool.query(
      `UPDATE memory.memories SET half_life_days = MAX(7, half_life_days + $1) WHERE id = ANY($2)`,
      [delta, memory_ids]
    );
    
    // Write audit log
    await writeAuditLog(pool, {
      event: merge_result.merged ? 'memory.feedback.merge_boost' : 'memory.feedback.reject_penalty',
      task_id: task.id,
      delta,
      fact_ids,
      memory_ids
    });
  }
  ```
  - Merge outcome boosts `half_life_days` by +5
  - Rejection penalises by −3
  - Minimum `half_life_days` is 7 (prevent premature decay)

**Status:** ✅ Implemented (fully wired as of this PR)

---

### FR-7: Importance Scoring
**Acceptance:** Facts are weighted by recency and retrieval frequency when assembled into context. Importance decays over time according to `half_life_days`.

**Implementation:**
- `agent/src/jobs/memory-lifecycle.ts` — `scoreImportance()`:
  ```typescript
  function scoreImportance(fact: Fact): number {
    const effective_age = (Date.now() - fact.last_retrieved_at) / (1000 * 60 * 60 * 24);  // days
    const strength = Math.pow(0.5, effective_age / fact.half_life_days);
    
    let boost = 0;
    if (fact.retrieval_count >= 20) boost += 2;
    else if (fact.retrieval_count >= 5) boost += 1;
    
    if (fact.confidence === 'stale') boost -= 1;
    
    return strength + boost;
  }
  ```
- Facts are ordered by `scoreImportance()` in descending order when building context
- Higher-scoring facts appear earlier in assembled context

---

## Implementation Status

| FR | File(s) | Notes |
|----|---------|-------|
| FR-1 (schema) | `scripts/infra/setup-memory-schema.sh` | All hippo-memory columns added idempotently (lines 79–111). File exists and is safe to re-run. **Pending operational step:** This file has not yet been run against the production database. Until it is, `search_memory` fails with `column f.confidence does not exist` and all hippo-memory features remain inert. |
| FR-2 (retrieval strengthening) | `mcp-server/src/memory-search.ts` | `strengthenRetrievals()` implemented as fire-and-forget. Uses `f.id` returned from both vector and keyword fact queries. Stale→observed revival included in the same UPDATE. |
| FR-3 (confidence tiers) | `mcp-server/src/facts.ts`, `mcp-server/src/context-assembly.ts`, `agent/src/jobs/memory-lifecycle.ts` | Episode-sourced facts default to `observed` via column default; memory-sourced explicitly set `inferred`. Decay job adds a batch UPDATE to transition to `stale` after 30 days. Confidence rendered in assembled context as `[confidence]` prefix on each fact. |
| FR-4 (conflict surfacing) | `mcp-server/src/facts.ts`, `mcp-server/src/context-assembly.ts` | `invalidateContradictions()` inserts a `fact_conflicts` record before invalidating. Context assembly queries 7-day conflicts and prefixes affected facts with `[CONFLICT]`. **Deviation:** only the new (valid) fact is marked `[CONFLICT]` — the old invalidated fact is not shown alongside it (spec said both should appear). |
| FR-5 (transfer scoring) | `mcp-server/src/memory-search.ts`, `mcp-server/src/context-assembly.ts` | `computeTransferScore()` matches spec exactly (base 0.5, portable +0.15, local −0.15). Cross-repo queries filter at `>= 0.5`. |
| FR-6 (outcome feedback) | `agent/src/jobs/merge-check.ts`, `mcp-server/src/pipeline.ts`, `mcp-server/src/context-assembly.ts`, `mcp-server/src/routes.ts` | `assembleContext()` accepts `includeIds: boolean` and returns `context_refs: { fact_ids, memory_ids }`. `/api/task` POST endpoint forwards `context_refs` to `createTask()`. `merge-check` reads `context_refs` and adjusts `half_life_days` (+5 merge, −3 rejection, min 7). **Fully wired.** |
| FR-7 (importance scoring) | `agent/src/jobs/memory-lifecycle.ts` | `scoreImportance()` rewritten with `0.5^(effective_age / half_life_days)` strength model. Retrieval boost (+1 ≥5, +2 ≥20) and stale penalty (−1) applied. |

### Known gaps: None

All planned features are implemented and wired. Schema migration file `setup-memory-schema.sh` exists and contains all required ALTER and CREATE statements. **Operational note:** The schema migration has not yet been applied to production; see FR-1 note above.

### Deviation: conflict pair display

Per FR-4, when a fact conflicts with an older fact, the spec originally called for both to appear in context prefixed with `[CONFLICT]`. The implementation marks only the new (valid) fact with `[CONFLICT]` because the old fact is already marked `stale` and filtered from most context queries. This is a practical deviation that preserves the intent (surface the conflict) without redundant fact rendering.

---

## Appendix: Decay Model

Facts decay in importance over time according to their `half_life_days`. The strength model is exponential:

```
strength(t) = 0.5 ^ (t / half_life_days)
```

where `t` is the time since `last_retrieved_at` in days.

### Example Timeline

A fact with `half_life_days = 30`:
- Day 0 (just retrieved): strength = 1.0
- Day 15: strength = 0.707
- Day 30: strength = 0.5
- Day 60: strength = 0.25
- Day 90: strength = 0.125

When a task using this fact is merged, `half_life_days` increases by 5 (e.g., 30 → 35), slowing decay. If rejected, it decreases by 3 (e.g., 30 → 27), accelerating decay toward `stale`.

---

## Appendix: Context Refs Format

When `includeIds: true` is passed to `assembleContext()`, the response includes:

```json
{
  "text": "...",
  "sections": [...],
  "context_refs": {
    "fact_ids": ["uuid-1", "uuid-2", ...],
    "memory_ids": ["uuid-3", "uuid-4", ...]
  }
}
```

These IDs are stored in `pipeline.tasks.context_refs` and later read by `merge-check.ts` to apply outcome feedback.
