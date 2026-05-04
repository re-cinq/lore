# Implementation Plan: Hippo-Memory Adaptations

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Hippo-Memory Adaptations             |
| Spec    | [spec.md](spec.md)                   |
| Status  | Implemented (Phase 6 wiring pending) |
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

`strengthenRetrievals()` runs after every `searchMemories()` call,
updating both facts and memories by their row `id`. Both `f.id` and
`f.confidence` were added to `vectorSearchFacts` and `keywordSearchFacts`
SELECT lists and propagated through `RankedRow` and `MemorySearchResult`
as optional `id` and `confidence` fields.

```typescript
async function strengthenRetrievals(pool: any, results: MemorySearchResult[]): Promise<void> {
  const factIds = results
    .filter(r => (r.source === 'fact' || r.source === 'episode') && r.id)
    .map(r => r.id!);
  const memoryIds = results
    .filter(r => r.source === 'memory' && r.id)
    .map(r => r.id!);

  const ops: Promise<void>[] = [];

  if (factIds.length > 0) {
    ops.push(pool.query(
      `UPDATE memory.facts
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 30) + 2, 365),
           confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END
       WHERE id = ANY($1)`,
      [factIds],
    ));
  }

  if (memoryIds.length > 0) {
    ops.push(pool.query(
      `UPDATE memory.memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 60) + 2, 365)
       WHERE id = ANY($1)`,
      [memoryIds],
    ));
  }

  await Promise.all(ops);
}
```

**As-built note:** The original plan proposed updating memories by
`(key, agent_id)` pairs. The implementation uses row `id` for both
facts and memories — cleaner and avoids key-collision edge cases.
Both `vectorSearchFacts` and `keywordSearchFacts` now return `f.id`.

### 2.2 Wire into searchMemories()

**File:** `mcp-server/src/memory-search.ts`

At the end of `searchMemories()`, after the audit log write:

```typescript
// Fire-and-forget retrieval strengthening
strengthenRetrievals(pool, results).catch(() => {});
```

### 2.3 Stale confidence revival on retrieval

Included in the facts UPDATE inside `strengthenRetrievals` (see 2.1):

```sql
confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END
```

A fact that comes back into active use is no longer stale — revival
happens atomically in the same batch UPDATE as the retrieval count bump.

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

**File:** `mcp-server/src/index.ts` (or wherever `search_memory`
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
  'convention', 'best-practice', 'anti-pattern'];
const LOCAL_KEYWORDS = ['config', 'deploy', 'url', 'auth',
  'secret', 'env', 'port', 'hostname', 'endpoint'];

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

**As-built note:** `'migration'` was originally in PORTABLE_KEYWORDS
and `'cron'` in LOCAL_KEYWORDS. Both were dropped from the shipped
implementation — `migration` has mixed portability (a migration
pattern is portable; a migration URL is not), and `cron` matched
benign text too broadly. Iterate the keyword lists based on
cross-repo episode feedback rather than pre-specifying edge cases.

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

## Phase 6: Outcome Feedback Loop — PARTIALLY WIRED

All code for this phase was written and deployed. The feedback path
is inert because one wiring call is missing. See the known gap below.

### 6.1 assembleContext() extended with includeIds

**File:** `mcp-server/src/context-assembly.ts`

`assembleContext()` accepts an optional `includeIds: boolean`
parameter. When true, it collects `fact_ids` and `memory_ids` from
all returned results and appends them as a `context_refs` field on
the return value. The surrounding assembly logic is unchanged.

### 6.2 createTask() stores context_refs

**File:** `mcp-server/src/pipeline.ts`

`createTask()` accepts an optional `contextRefs` parameter and
stores it to `pipeline.tasks.context_refs` via a follow-up UPDATE.
Schema column was added in Phase 1.4.

### 6.3 merge-check reads context_refs and adjusts half-lives

**File:** `agent/src/jobs/merge-check.ts`

On PR merge, the job reads `context_refs` from the task row and
extends `half_life_days` by +5 (capped at 365) on contributing
facts and memories. On PR rejection (closed without merge), it
penalises by -3 (floor at 7). Both outcomes write an audit entry:

```typescript
if (task.context_refs) {
  const refs = typeof task.context_refs === 'string'
    ? JSON.parse(task.context_refs)
    : task.context_refs;
  // +5 merge / -3 reject updates on refs.fact_ids and refs.memory_ids
  // audit_log: operation = 'outcome-feedback'
}
```

The block is wrapped in try/catch — outcome feedback is best-effort.

### Known gap: context_refs is never populated

The `/api/context` handler in `mcp-server/src/routes.ts` calls
`assembleContext()` **without** `includeIds: true`, so the response
never carries `context_refs`. The `/api/task` POST handler therefore
never forwards refs to `createTask()`. When `merge-check` runs, it
finds `context_refs = null` and silently skips the adjustment.

**To close this gap (two-line fix):**

1. In `mcp-server/src/routes.ts`, the `/api/context` handler — pass
   `includeIds: true` as the 7th argument to `assembleContext()`.
2. In the `/api/task` POST handler — forward `result.context_refs` to
   `createTask()` as the `contextRefs` parameter.

All downstream code (merge-check adjustments, audit logging) is already
in place and will activate automatically once refs flow through.

---

## Phase 7: Updated Importance Scoring

### 7.1 Rewrite scoreImportance()

**File:** `agent/src/jobs/memory-lifecycle.ts`

```typescript
function scoreImportance(memory: {
  key: string;
  value: string;
  created_at: string;
  last_retrieved_at?: string | null;
  half_life_days?: number | null;
  retrieval_count?: number | null;
  confidence?: string | null;
}): number {
  const halfLife = memory.half_life_days || 60;
  const effectiveDate = memory.last_retrieved_at || memory.created_at;
  const effectiveAgeDays = (Date.now() - new Date(effectiveDate).getTime()) / 86400000;

  // strength decays from 1.0 → 0.0 as age/half_life grows
  const strength = Math.pow(0.5, effectiveAgeDays / halfLife);

  // Map strength (0-1) directly to score (0-10)
  let score = Math.round(strength * 10);

  // Content richness
  if (memory.value.length < 50) score -= 2;
  else if (memory.value.length > 500) score += 1;

  // Key-based importance
  if (memory.key.startsWith("auto-curation/")) score -= 1;
  if (memory.key.startsWith("session-summary/")) score -= 1;
  if (memory.key.includes("gotcha") || memory.key.includes("decision")) score += 2;
  if (memory.key.includes("convention") || memory.key.includes("pattern")) score += 2;

  // Retrieval frequency boost
  const retrievals = memory.retrieval_count || 0;
  if (retrievals >= 20) score += 2;
  else if (retrievals >= 5) score += 1;

  // Stale confidence penalty
  if (memory.confidence === 'stale') score -= 1;

  return Math.max(0, Math.min(10, score));
}
```

**As-built note:** The original plan used `let score = 5` baseline
with `score += Math.round(strength * 7) - 5` (a -5 to +2 modifier).
The implementation uses `let score = Math.round(strength * 10)` —
a cleaner direct mapping of strength to the full 0-10 range. The
`confidence` parameter was added to support the stale penalty.
Both approaches produce a 0-10 result; the direct mapping gives
stronger separation between recently-active and dormant memories.

### 7.2 Update the decay job query

**File:** `agent/src/jobs/memory-lifecycle.ts`

The candidates query selects the new columns:

```sql
SELECT id, key, value, created_at, last_retrieved_at,
       half_life_days, retrieval_count
FROM memory.memories
WHERE agent_id = $1 AND is_deleted = FALSE
  AND created_at < now() - interval '30 days'
ORDER BY created_at ASC
LIMIT $2
```

**Note:** `confidence` is not in the candidates query for memories —
the stale penalty in `scoreImportance()` is only exercised for facts
passed through the memory path. The field is present on the function
signature for future use.

---

## Files Changed Summary

| File | Phase | Change | Status |
|------|-------|--------|--------|
| `scripts/infra/setup-memory-schema.sh` | 1 | Add `retrieval_count`, `last_retrieved_at`, `half_life_days` to facts + memories. Add `confidence` column + CHECK. Create `fact_conflicts` table. Add `context_refs` to `pipeline.tasks`. | ✓ Deployed |
| `mcp-server/src/memory-search.ts` | 2, 5 | Add `id` + `confidence` to result types and queries. Add `strengthenRetrievals()` (ID-based). Add `computeTransferScore()`. | ✓ Deployed |
| `mcp-server/src/facts.ts` | 3, 4 | Set `confidence = 'inferred'` on memory-sourced INSERT. Insert `fact_conflicts` records before invalidation. | ✓ Deployed |
| `agent/src/jobs/memory-lifecycle.ts` | 3, 7 | Add stale confidence transition. Rewrite `scoreImportance()` with direct strength→score mapping. Update candidate query. | ✓ Deployed |
| `mcp-server/src/context-assembly.ts` | 3, 4, 5, 6 | Render confidence annotations. Surface `[CONFLICT]` tag (new fact only). Filter cross-repo by transfer score. Add `includeIds` path for `context_refs`. | ✓ Deployed |
| `mcp-server/src/pipeline.ts` | 6 | `createTask()` accepts and stores `contextRefs`. | ✓ Deployed |
| `agent/src/jobs/merge-check.ts` | 6 | Read `context_refs`, adjust `half_life_days` on merge (+5) and reject (-3). Audit log. | ✓ Deployed, inert |
| `mcp-server/src/routes.ts` | 6 | `/api/context` handler must pass `includeIds: true` + forward `context_refs` to task creation. | ✗ Missing wiring |

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
with retrieval strengthening and outcome feedback. The final design
decisions are formalized in [ADR-016: Hippo-memory adaptations](../../adrs/ADR-016-hippo-memory-adaptations.md),
which supersedes this plan as the authoritative record. The ADR
documents the Phase 6 known gap and the two-line fix required to
activate the outcome feedback loop.
