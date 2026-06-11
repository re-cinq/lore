# Implementation Plan: Hippo-Memory Adaptations

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Hippo-Memory Adaptations             |
| Spec    | [spec.md](spec.md)                   |
| Status  | Draft                                |
| Created | 2026-04-07                           |
| Issue   | [re-cinq/lore#205](https://github.com/re-cinq/lore/issues/205) |

## Overview

Six enhancements to Lore's memory system inspired by
[kitfunso/hippo-memory](https://github.com/kitfunso/hippo-memory).
Ordered by dependency chain: schema first, then retrieval
strengthening (foundation for everything else), confidence tiers,
conflict surfacing, transfer scoring, outcome feedback, and finally
the updated importance scorer that ties it all together.

## Phase 1: Schema Migrations (no code changes)

### 1.1 Add retrieval metadata columns

**File:** `scripts/infra/setup-memory-schema.sh`

Add idempotent ALTER TABLE statements after the existing temporal
fact columns (around line 72):

```sql
-- Retrieval strengthening (hippo-memory inspired)
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 30;

ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 60;
```

**Why memories get a longer default half-life (60d vs 30d):**
Memories are explicit key-value pairs written by agents (higher
signal). Facts are auto-extracted fragments (noisier, should decay
faster).

### 1.2 Add confidence column to facts

**File:** `scripts/infra/setup-memory-schema.sh`

```sql
ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'observed';

DO $$ BEGIN
  ALTER TABLE memory.facts ADD CONSTRAINT facts_confidence_check
    CHECK (confidence IN ('verified', 'observed', 'inferred', 'stale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

### 1.3 Create fact_conflicts table

**File:** `scripts/infra/setup-memory-schema.sh`

```sql
CREATE TABLE IF NOT EXISTS memory.fact_conflicts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  new_fact_id UUID NOT NULL REFERENCES memory.facts(id),
  similarity  FLOAT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fact_conflicts_old_idx
  ON memory.fact_conflicts (old_fact_id);
CREATE INDEX IF NOT EXISTS fact_conflicts_new_idx
  ON memory.fact_conflicts (new_fact_id);
```

### 1.4 Add context_refs to pipeline tasks

**File:** `scripts/infra/setup-memory-schema.sh` (or the pipeline
schema section if separate)

```sql
ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS context_refs JSONB;
```

---

## Phase 2: Retrieval Strengthening

The highest-impact, lowest-effort change. ~30 lines of code.

### 2.1 Add retrieval update function

**File:** `mcp-server/src/memory-search.ts`

Add a new async function after the `searchMemories()` export:

```typescript
/**
 * Fire-and-forget: bump retrieval stats on returned results.
 * Updates both facts and memories tables. Never blocks the caller.
 */
async function strengthenRetrievals(
  pool: any,
  results: MemorySearchResult[],
): Promise<void> {
  const factIds: string[] = [];
  const memoryKeys: { agent_id: string; key: string }[] = [];

  for (const r of results) {
    if (r.source === 'fact' || r.source === 'episode') {
      // Fact IDs aren't in search results currently — need to
      // join back or return them. See design note below.
    }
    if (r.source === 'memory') {
      memoryKeys.push({ agent_id: r.agent_id, key: r.key });
    }
  }

  // Batch update memories
  if (memoryKeys.length > 0) {
    const keys = memoryKeys.map(m => m.key);
    const agents = memoryKeys.map(m => m.agent_id);
    await pool.query(
      `UPDATE memory.memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 60) + 2, 365)
       WHERE key = ANY($1) AND agent_id = ANY($2)`,
      [keys, agents],
    ).catch(() => {});
  }
}
```

**Design decision — fact ID propagation:** The current search
queries don't return `f.id` for facts. Two options:

- **Option A (recommended):** Add `f.id` to the SELECT in
  `vectorSearchFacts` and `keywordSearchFacts`, propagate through
  `RankedRow` and `MemorySearchResult` as an optional `fact_id`
  field. This lets `strengthenRetrievals` batch-update by ID.
- **Option B:** Match facts by `(agent_id, fact_text)` in the
  UPDATE. Slower, risk of collisions on identical fact text.

Go with Option A. Add `fact_id?: string` to `MemorySearchResult`
and `RankedRow`, return `f.id` from both vector and keyword fact
queries.

### 2.2 Wire into searchMemories()

**File:** `mcp-server/src/memory-search.ts`

At the end of `searchMemories()`, after audit log, add:

```typescript
// Fire-and-forget retrieval strengthening
strengthenRetrievals(pool, results).catch(() => {});
```

### 2.3 Stale confidence revival on retrieval

Inside `strengthenRetrievals`, for facts with `confidence = 'stale'`,
also set `confidence = 'observed'`:

```sql
UPDATE memory.facts
SET retrieval_count = retrieval_count + 1,
    last_retrieved_at = now(),
    half_life_days = LEAST(COALESCE(half_life_days, 30) + 2, 365),
    confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END
WHERE id = ANY($1::uuid[])
```

---

## Phase 3: Confidence Tiers

### 3.1 Set confidence on fact extraction

**File:** `mcp-server/src/facts.ts`

In `extractFacts()` (memory-sourced), change the INSERT to set
`confidence = 'inferred'`:

```sql
INSERT INTO memory.facts (memory_id, fact_text, embedding, valid_from, confidence)
VALUES ($1, $2, $3, now(), 'inferred')
```

In `extractFactsFromEpisode()` (episode-sourced), keep
`confidence = 'observed'` (the default).

### 3.2 Decay job: transition to stale

**File:** `agent/src/jobs/memory-lifecycle.ts`

Add a batch UPDATE at the beginning of `importanceDecayJob()`:

```typescript
// Transition unretrieved facts to 'stale' after 30 days
await query(
  `UPDATE memory.facts
   SET confidence = 'stale'
   WHERE confidence IN ('observed', 'inferred')
     AND valid_to IS NULL
     AND COALESCE(last_retrieved_at, created_at) < now() - interval '30 days'`,
);
```

### 3.3 Surface confidence in search results

**File:** `mcp-server/src/memory-search.ts`

Add `confidence?: string` to `MemorySearchResult`. Populate from
fact queries (add `f.confidence` to SELECT).

**File:** `mcp-server/src/context-assembly.ts`

When rendering facts in assembled context, prefix with confidence
tier: `[verified] The API uses REST` or `[stale] Deployment uses
Helm v3.12`.

### 3.4 Expose in MCP tool response

**File:** `mcp-server/src/index.ts` (or wherever `lore_search_memory`
formats its response)

Include `confidence` field in the response JSON for fact results.
No change to the tool schema (it's additive).

---

## Phase 4: Conflict Surfacing

### 4.1 Record conflicts on contradiction detection

**File:** `mcp-server/src/facts.ts`

In `invalidateContradictions()`, before setting `valid_to` on the
old fact, insert a conflict record:

```typescript
// Record the conflict for surfacing
await pool.query(
  `INSERT INTO memory.fact_conflicts (old_fact_id, new_fact_id, similarity)
   VALUES ($1, $2, $3)`,
  [row.id, newFactId, row.similarity],
);
```

This is a ~5-line addition inside the existing `for (const row of rows)`
loop at `facts.ts:249`.

### 4.2 Surface conflicts in context assembly

**File:** `mcp-server/src/context-assembly.ts`

When assembling facts, check if any have conflicts:

```sql
SELECT fc.old_fact_id, fc.new_fact_id, fc.similarity,
       old_f.fact_text AS old_text, new_f.fact_text AS new_text
FROM memory.fact_conflicts fc
JOIN memory.facts old_f ON old_f.id = fc.old_fact_id
JOIN memory.facts new_f ON new_f.id = fc.new_fact_id
WHERE fc.new_fact_id = ANY($1::uuid[])
  AND fc.created_at > now() - interval '7 days'
```

Prefix conflicting facts with `[CONFLICT: replaces "<old_text>"]`.
Limit to conflicts from the last 7 days to avoid noise.

---

## Phase 5: Transfer Scoring

### 5.1 Add transfer score function

**File:** `mcp-server/src/memory-search.ts`

```typescript
const PORTABLE_KEYWORDS = ['error', 'pattern', 'gotcha', 'rule',
  'convention', 'best-practice', 'anti-pattern', 'migration'];
const LOCAL_KEYWORDS = ['config', 'deploy', 'url', 'auth',
  'secret', 'env', 'port', 'hostname', 'endpoint', 'cron'];

export function computeTransferScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0.5;
  for (const kw of PORTABLE_KEYWORDS) {
    if (lower.includes(kw)) score += 0.15;
  }
  for (const kw of LOCAL_KEYWORDS) {
    if (lower.includes(kw)) score -= 0.15;
  }
  return Math.max(0, Math.min(1, score));
}
```

### 5.2 Apply in cross-repo context assembly

**File:** `mcp-server/src/context-assembly.ts`

In the `cross_repo` source handler, after fetching facts from
linked repos, filter:

```typescript
const crossRepoFacts = results.filter(
  r => computeTransferScore(r.value) >= 0.5,
);
```

Import `computeTransferScore` from `memory-search.ts`.

---

## Phase 6: Outcome Feedback Loop

### 6.1 Capture context refs at task creation

**File:** `mcp-server/src/index.ts` (or the task creation handler
in `routes.ts`)

When `lore_create_pipeline_task` is called, if context was assembled
for this task, store the fact/memory IDs in `context_refs`:

```typescript
// After assembling context for the task prompt
const contextRefs = {
  fact_ids: assembledFacts.map(f => f.id),
  memory_keys: assembledMemories.map(m => ({ key: m.key, agent_id: m.agent_id })),
};
// Include in INSERT
await pool.query(
  `UPDATE pipeline.tasks SET context_refs = $2 WHERE id = $1`,
  [taskId, JSON.stringify(contextRefs)],
);
```

**Note:** The exact integration point depends on how context is
currently assembled for tasks. In the local runner
(`mcp-server/src/local-runner.ts`), context is fetched via
`/api/context` before spawning Claude Code. The API response
should include IDs that the runner can store. Similarly, the GKE
runner (`docker/claude-runner/entrypoint.sh`) fetches context via
curl — the response needs to include IDs.

For this to work, `lore_assemble_context` needs to return IDs alongside
text. Add an optional `include_ids: boolean` parameter to the
internal `assembleContext()` function that returns structured
results with IDs.

### 6.2 Wire merge-check to adjust half-lives

**File:** `agent/src/jobs/merge-check.ts`

After the existing episode capture on PR merge (around line 100),
add:

```typescript
// Outcome feedback: strengthen contributing facts/memories
if (task.context_refs) {
  try {
    const refs = typeof task.context_refs === 'string'
      ? JSON.parse(task.context_refs)
      : task.context_refs;

    if (refs.fact_ids?.length > 0) {
      await query(
        `UPDATE memory.facts
         SET half_life_days = LEAST(COALESCE(half_life_days, 30) + 5, 365)
         WHERE id = ANY($1::uuid[])`,
        [refs.fact_ids],
      );
    }
    if (refs.memory_keys?.length > 0) {
      for (const mk of refs.memory_keys) {
        await query(
          `UPDATE memory.memories
           SET half_life_days = LEAST(COALESCE(half_life_days, 60) + 5, 365)
           WHERE key = $1 AND agent_id = $2`,
          [mk.key, mk.agent_id],
        );
      }
    }
    // Audit log
    await query(
      `INSERT INTO memory.audit_log (agent_id, operation, metadata)
       VALUES ('merge-check', 'outcome-feedback', $1)`,
      [JSON.stringify({ task_id: task.id, outcome: 'merged', refs })],
    );
  } catch { /* outcome feedback is best-effort */ }
}
```

Add corresponding code for PR rejection (around line 155), using
`half_life_days = GREATEST(7, COALESCE(half_life_days, 30) - 3)`.

---

## Phase 7: Updated Importance Scoring

### 7.1 Rewrite scoreImportance()

**File:** `agent/src/jobs/memory-lifecycle.ts`

Replace the current `scoreImportance()` function with a half-life-
aware version:

```typescript
function scoreImportance(memory: {
  key: string;
  value: string;
  created_at: string;
  last_retrieved_at?: string | null;
  half_life_days?: number | null;
  retrieval_count?: number | null;
}): number {
  let score = 5; // baseline

  // Half-life-aware recency (replaces raw created_at decay)
  const halfLife = memory.half_life_days || 60;
  const lastActive = memory.last_retrieved_at || memory.created_at;
  const daysSinceActive = (Date.now() - new Date(lastActive).getTime()) / 86400000;
  const strength = Math.pow(0.5, daysSinceActive / halfLife);
  // Map strength (0-1) to a -5 to +2 modifier
  score += Math.round(strength * 7) - 5;

  // Content richness (unchanged)
  if (memory.value.length < 50) score -= 2;
  else if (memory.value.length > 500) score += 1;

  // Key-based importance boost (unchanged)
  if (memory.key.startsWith("auto-curation/")) score -= 1;
  if (memory.key.startsWith("session-summary/")) score -= 1;
  if (memory.key.includes("gotcha") || memory.key.includes("decision")) score += 2;
  if (memory.key.includes("convention") || memory.key.includes("pattern")) score += 2;

  // Retrieval count boost (new)
  const rc = memory.retrieval_count || 0;
  if (rc >= 20) score += 2;
  else if (rc >= 5) score += 1;

  return Math.max(0, Math.min(10, score));
}
```

### 7.2 Update the decay job query

**File:** `agent/src/jobs/memory-lifecycle.ts`

The candidates query (line 79) needs to include the new columns:

```sql
SELECT id, key, value, created_at, last_retrieved_at,
       half_life_days, retrieval_count
FROM memory.memories
WHERE agent_id = $1 AND is_deleted = FALSE
  AND created_at < now() - interval '30 days'
ORDER BY created_at ASC
LIMIT $2
```

---

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `scripts/infra/setup-memory-schema.sh` | 1 | Add `retrieval_count`, `last_retrieved_at`, `half_life_days` to facts + memories. Add `confidence` column. Create `fact_conflicts` table. Add `context_refs` to `pipeline.tasks`. |
| `mcp-server/src/memory-search.ts` | 2, 5 | Add `fact_id` to result types and queries. Add `strengthenRetrievals()`. Add `computeTransferScore()`. Add `confidence` to results. |
| `mcp-server/src/facts.ts` | 3, 4 | Set `confidence` on INSERT. Insert `fact_conflicts` records in `invalidateContradictions()`. |
| `agent/src/jobs/memory-lifecycle.ts` | 3, 7 | Add stale confidence transition. Rewrite `scoreImportance()` with half-life model. Update candidate query. |
| `mcp-server/src/context-assembly.ts` | 3, 4, 5 | Render confidence annotations. Surface conflicts. Filter cross-repo by transfer score. |
| `mcp-server/src/index.ts` | 3 | Add `confidence` to `lore_search_memory` response. |
| `agent/src/jobs/merge-check.ts` | 6 | Read `context_refs`, adjust `half_life_days` on merge/reject. |
| `mcp-server/src/routes.ts` or task creation code | 6 | Store `context_refs` on task creation. |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Retrieval strengthening adds write load on every search | Fire-and-forget async, single batch UPDATE per search. Monitor with OTEL. |
| Confidence tiers add noise to context output | Only show tier for `stale` and `verified` (omit `observed`/`inferred` as they're the default). |
| Conflict surfacing could surface too many old conflicts | 7-day window on conflict queries, max 3 conflicts per context assembly. |
| Transfer scoring keyword list is naive | Start with keyword heuristics, iterate based on cross-repo feedback episodes. |
| Outcome feedback requires context_refs to be populated | Fail-open: if `context_refs` is null, skip feedback. Backfill not needed. |
| Half-life model changes eviction behavior | Existing memories have default half-life (60d), so they score identically to the current model until retrieved or feedback-adjusted. |

## Testing Strategy

- **Unit tests:** `parseFacts`, `computeTransferScore`,
  `scoreImportance` (with and without half-life/retrieval data).
- **Integration tests:** Full search → retrieval strengthening →
  re-search cycle showing increased `retrieval_count`.
- **Schema migration test:** Run `setup-memory-schema.sh` twice —
  second run must be a no-op.
- **Manual validation:** Deploy to staging, run several searches,
  verify `retrieval_count` and `last_retrieved_at` are updated.
  Trigger a merge-check cycle and verify `half_life_days` adjusted.

## ADR Reference

This plan extends [ADR-014: Intelligent memory lifecycle](../../adrs/ADR-014-passive-memory-capture.md)
with retrieval strengthening and outcome feedback. Consider a
follow-up ADR (ADR-015) if the half-life model proves successful
and we want to formalize it as the primary decay mechanism.
