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
- `half_life_days INT DEFAULT 30` — decay rate; adjusted by outcome feedback (FR-6)
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
**Status:** ✅ COMPLETE

**Acceptance:** All hippo-memory columns and tables exist and are idempotent to re-apply.

**Implementation:** `scripts/infra/setup-memory-schema.sh` contains all ALTER and CREATE TABLE statements with `IF NOT EXISTS` guards.

**Run:** Execute in production:
```bash
psql -h $DB_HOST -U $DB_USER -d lore < scripts/infra/setup-memory-schema.sh
```

**Verification:** After running, confirm columns exist:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'facts' AND column_name IN ('retrieval_count', 'confidence', 'half_life_days', 'last_retrieved_at');
SELECT tablename FROM pg_tables WHERE tablename = 'fact_conflicts';
```

---

### FR-2: Retrieval Strengthening
**Status:** ✅ COMPLETE

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
**Status:** ✅ COMPLETE

**Acceptance:** Facts have a `confidence` level. Episode facts default to `observed`; memory-sourced facts default to `inferred`. Facts older than 30 days without retrieval transition to `stale`. Context assembly prefixes each fact with `[confidence]`.

**Implementation:**
- `mcp-server/src/facts.ts` — when inserting a fact, set `confidence = 'observed'` (column default for episode facts)
- `mcp-server/src/facts.ts` — when upserting memory-sourced facts, set `confidence = 'inferred'`
- `agent/src/jobs/memory-lifecycle.ts` — `decayStaleMemory()` batch job:
  ```sql
  UPDATE memory.facts SET confidence = 'stale' 
  WHERE last_retrieved_at < now() - '30 days'::interval 
    AND confidence != 'stale';
  ```
- `mcp-server/src/context-assembly.ts` — when rendering facts, prefix with `[${fact.confidence}]`:
  ```
  [observed] User prefers dark mode
  [inferred] Project uses TypeScript
  [stale] Team size: 4 (needs refresh)
  ```

---

### FR-4: Conflict Surfacing
**Status:** ✅ COMPLETE

**Acceptance:** When a new fact contradicts an older fact, both are flagged in context. The system records the conflict for audit and learning.

**Implementation:**
- `mcp-server/src/facts.ts` — `invalidateContradictions(pool, new_fact_id, old_fact_ids)`:
  1. Insert row into `memory.fact_conflicts` for each pair
  2. Update old fact's `confidence = 'stale'`
  3. Write audit log entry
- `mcp-server/src/context-assembly.ts` — when assembling context:
  1. Query `fact_conflicts` for any conflicts involving returned facts (7-day window)
  2. Prefix conflicted facts with `[CONFLICT]`

**Deviation:** Only the new (valid) fact is marked `[CONFLICT]` in the returned context. The old invalidated fact is not shown alongside it because it is already marked `stale` and filtered from most queries.

---

### FR-5: Transfer Scoring
**Status:** ✅ COMPLETE

**Acceptance:** Cross-repo facts are ranked by portability. A score ≥ 0.5 is required to include them.

**Implementation:**
- `mcp-server/src/memory-search.ts` — `computeTransferScore(fact, query_repo)`:
  ```
  base = 0.5
  if (fact is portable): score += 0.15
  if (fact is local-only): score -= 0.15
  return score
  ```
  - Portable keywords: `error`, `pattern`, `gotcha`, `rule`, `convention`, `best-practice`, `anti-pattern`
  - Local keywords: `config`, `deploy`, `url`, `auth`, `secret`, `env`, `port`, `hostname`, `endpoint`

- `mcp-server/src/context-assembly.ts` — cross-repo queries filter at `transferScore >= 0.5`

---

### FR-6: Outcome Feedback
**Status:** ✅ COMPLETE

**Acceptance:** When a task completes (merged or rejected), the facts and memories used to assemble its context are rewired via their `half_life_days`.

**Implementation:**

1. **Context Assembly** — `mcp-server/src/context-assembly.ts`:
   ```typescript
   async function assembleContext(
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

2. **Search Endpoint** — `mcp-server/src/routes.ts` (~line 299):
   ```typescript
   const result = await assembleContext(
     pool, query, template, 8000, repo || undefined, 
     undefined, undefined, true  // includeIds = true
   );
   json(res, 200, {
     text: result.text || null,
     sections: result.sections,
     context_refs: result.context_refs  // NEW
   });
   ```

3. **Task Creation** — `mcp-server/src/pipeline.ts`:
   ```typescript
   async function createTask(
     pool: Pool,
     description: string,
     task_type: string,
     target_repo: string,
     priority: number,
     context: string,
     contextRefs?: { fact_ids: UUID[]; memory_ids: UUID[] }  // NEW
   ): Promise<Task>
   ```
   - Store `contextRefs` in `pipeline.tasks.context_refs` JSONB column

4. **Task Endpoint** — `mcp-server/src/routes.ts` (POST /api/task):
   ```typescript
   const { description, task_type, target_repo, priority, context, context_refs } = parsed;  // NEW param
   const task = await createTask(
     pool, description, task_type, target_repo, priority, context, context_refs
   );
   ```

5. **Merge Outcome Processing** — `agent/src/jobs/merge-check.ts`:
   ```typescript
   async function processMergeOutcome(pool: Pool, merge_result: MergeResult) {
     const task = await getTask(pool, merge_result.task_id);
     if (!task.context_refs) return;  // Nothing to update
     
     const delta = merge_result.merged ? +5 : -3;  // Merge boost, reject penalty
     const fact_ids = task.context_refs.fact_ids || [];
     const memory_ids = task.context_refs.memory_ids || [];
     
     // Adjust half_life for used facts/memories
     await pool.query(
       `UPDATE memory.facts SET half_life_days = GREATEST(7, half_life_days + $1) 
        WHERE id = ANY($2)`,
       [delta, fact_ids]
     );
     await pool.query(
       `UPDATE memory.memories SET half_life_days = GREATEST(7, half_life_days + $1) 
        WHERE id = ANY($2)`,
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

- **Merge outcome** boosts `half_life_days` by **+5**
- **Rejection** penalises by **−3**
- **Minimum** `half_life_days` is **7** (prevents premature decay)
- **Audit logging** required for all outcome adjustments

---

### FR-7: Importance Scoring
**Status:** ✅ COMPLETE

**Acceptance:** Facts are weighted by recency and retrieval frequency when assembled into context. Importance decays over time according to `half_life_days`.

**Implementation:**
- `agent/src/jobs/memory-lifecycle.ts` — `scoreImportance()`:
  ```typescript
  function scoreImportance(fact: Fact): number {
    const effective_age_days = 
      (Date.now() - (fact.last_retrieved_at?.getTime() || fact.created_at.getTime())) 
      / (1000 * 60 * 60 * 24);
    
    // Exponential decay by half-life
    const strength = Math.pow(0.5, effective_age_days / fact.half_life_days);
    
    // Retrieval frequency boost
    let boost = 0;
    if (fact.retrieval_count >= 20) boost += 2;
    else if (fact.retrieval_count >= 5) boost += 1;
    
    // Confidence penalty
    if (fact.confidence === 'stale') boost -= 1;
    
    return strength + boost;
  }
  ```

- Facts are ordered by `scoreImportance()` in **descending order** when building context
- Higher-scoring facts appear earlier in assembled context sections

---

## Decay Model Reference

Facts decay in importance over time according to their `half_life_days`. The strength model is exponential:

```
strength(t) = 0.5 ^ (t / half_life_days)
```

where `t` is the time since `last_retrieved_at` in days.

### Example Timeline

A fact with `half_life_days = 30`:
- Day 0 (just retrieved): strength = 1.0
- Day 15: strength ≈ 0.71
- Day 30: strength = 0.5
- Day 60: strength = 0.25
- Day 90: strength = 0.125

When a task using this fact is **merged**, `half_life_days` increases by 5 (e.g., 30 → 35), slowing decay.
When a task is **rejected**, `half_life_days` decreases by 3 (e.g., 30 → 27), accelerating decay toward `stale`.

---

## Context Refs Format

When `includeIds: true` is passed to `assembleContext()`, the response includes:

```json
{
  "text": "...",
  "sections": [...],
  "context_refs": {
    "fact_ids": ["550e8400-e29b-41d4-a716-446655440000", "..."],
    "memory_ids": ["550e8400-e29b-41d4-a716-446655440001", "..."]
  }
}
```

These IDs are stored in `pipeline.tasks.context_refs` and later read by `merge-check.ts` to apply outcome feedback.

---

## Implementation Checklist

- [x] FR-1: Schema migration file created with all idempotent statements
- [x] FR-2: Retrieval strengthening wired into memory-search.ts
- [x] FR-3: Confidence tiers integrated into facts extraction and context rendering
- [x] FR-4: Conflict table created and invalidation flow captures conflicts
- [x] FR-5: Transfer scoring computed and applied to cross-repo queries
- [x] FR-6: Context refs captured, stored on tasks, and wired to merge-check outcome feedback
- [x] FR-7: Importance scoring rewritten with half-life decay model

---

## Post-Implementation Steps

1. **Run schema migration** (production):
   ```bash
   psql -h $DB_HOST -U $DB_USER -d lore < scripts/infra/setup-memory-schema.sh
   ```

2. **Verify schema changes**:
   ```sql
   -- Check memory.facts columns
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'facts' 
   AND column_name IN ('retrieval_count', 'confidence', 'half_life_days', 'last_retrieved_at');
   
   -- Check memory.fact_conflicts table
   SELECT tablename FROM pg_tables WHERE tablename = 'fact_conflicts';
   
   -- Check pipeline.tasks column
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'tasks' AND column_name = 'context_refs';
   ```

3. **Monitor logs** for retrieval strengthening and outcome feedback events in audit_log.

4. **Test outcome feedback** with a manual task creation + merge to verify half_life_days adjustments.
