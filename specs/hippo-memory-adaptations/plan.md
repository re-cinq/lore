# Implementation Plan: Hippo-Memory Adaptations

| Field   | Value                                                      |
|---------|------------------------------------------------------------|
| Feature | Hippo-Memory Adaptations                                   |
| Branch  | `feat/hippo-memory-adaptations`                            |
| Spec    | [spec.md](spec.md)                                         |
| Status  | Draft                                                      |
| Created | 2026-04-07                                                 |

## Technical Context

### Stack

| Layer          | Technology                       | Notes                           |
|----------------|----------------------------------|---------------------------------|
| DB schema      | PostgreSQL + pgvector             | `ADD COLUMN IF NOT EXISTS` only |
| Fact extraction| `mcp-server/src/facts.ts`        | Already has `invalidateContradictions()` |
| Memory search  | `mcp-server/src/memory-search.ts`| Already has RRF + graph augment |
| Context assembly| `mcp-server/src/context-assembly.ts` | YAML-template driven       |
| Lifecycle job  | `agent/src/jobs/memory-lifecycle.ts` | Daily 5 AM / 5:30 AM       |
| Watcher job    | `agent/src/jobs/loretask-watcher.ts` | Handles `merge-check`      |
| MCP tool defs  | `mcp-server/src/index.ts`        | Zod schemas                     |

### Key Dependencies

| Dependency              | Purpose                                | Risk  |
|-------------------------|----------------------------------------|-------|
| `memory.audit_log`      | Source of truth for outcome feedback   | Low — already populated |
| `invalidateContradictions()` | Conflict surfacing hooks here     | Low — stable API |
| `scoreImportance()`     | Retrieval signals wire in here         | Low — small function |
| `assemble_context` template YAML | Conflict + confidence output  | Low — additive |

### Repository Structure

```
mcp-server/src/
  memory-search.ts       ← async retrieval UPDATE, confidence_min filter
  memory.ts              ← (no changes needed)
  facts.ts               ← confidence assignment on extractFacts()
  context-assembly.ts    ← conflict surfacing, transfer scoring, memory_keys audit
  index.ts               ← confidence_min param on search_memory

agent/src/jobs/
  memory-lifecycle.ts    ← scoreImportance() update, stale confidence decay job
  loretask-watcher.ts    ← outcome feedback delta on merge-check

scripts/infra/
  setup-memory-schema.sh ← new columns on memories + facts

specs/hippo-memory-adaptations/
  spec.md
  plan.md
  tasks.md
  research.md
  contracts/db-schema.md
```

## Implementation Phases

### Phase 1: Schema + Retrieval Strengthening (Feature A) — ~1 day

This is the foundation. Features B and F both depend on columns added here.

#### 1.1 Schema migration

**File:** `scripts/infra/setup-memory-schema.sh`

Add the DDL from `contracts/db-schema.md`:
- `memory.memories`: `last_retrieved_at`, `retrieval_count`
- `memory.facts`: `confidence`, `last_retrieved_at`, `retrieval_count`
- Two new indexes

Follow the existing pattern — find the section that adds `memory.memories`
columns and append `ADD COLUMN IF NOT EXISTS` statements. Same for `memory.facts`.

**Verification:** Re-running `setup-memory-schema.sh` is idempotent (no errors on
second run due to `IF NOT EXISTS` guards).

#### 1.2 Async retrieval UPDATE in searchMemories()

**File:** `mcp-server/src/memory-search.ts`

After `results` is assembled (currently around line 100, after the RRF merge),
extract the memory IDs from the results and fire an async UPDATE:

```typescript
// fire-and-forget: do not await
pool.query(
  `UPDATE memory.memories
     SET retrieval_count = retrieval_count + 1,
         last_retrieved_at = now()
   WHERE id = ANY($1::uuid[])`,
  [results.map(r => r.id)]
).catch(err => logger.warn('retrieval_count update failed', { err }));
```

Note: `MemorySearchResult` must expose `id` (UUID of the backing memory row).
Check current type definition — if `id` is not present in results, add it.

**Verification:** After a `search_memory` call, query `memory.memories` directly
and confirm `retrieval_count` incremented and `last_retrieved_at` updated.

#### 1.3 Wire retrieval signals into scoreImportance()

**File:** `agent/src/jobs/memory-lifecycle.ts`

`scoreImportance()` (lines 35–57) currently scores 0–10 from recency + content +
key pattern. Add two new signals from the memory row (must pass
`last_retrieved_at` and `retrieval_count` into the function or include them in
the `Memory` type passed to the scorer):

```typescript
// +1 if retrieved in the last 7 days
if (lastRetrievedAt && daysSince(lastRetrievedAt) < 7) score += 1;

// +1 if retrieval_count >= 5
if (retrievalCount >= 5) score += 1;
```

The decay job query already selects all memory columns; no additional DB query
needed — just destructure `retrieval_count` and `last_retrieved_at` from the
fetched row.

**Verification:** Unit-test `scoreImportance()` with a memory that has
`retrieval_count=10, last_retrieved_at=yesterday` vs one with
`retrieval_count=0, last_retrieved_at=null`. Former must score at least 2 higher.

---

### Phase 2: Epistemic Confidence Tiers (Feature B) — ~2 days

#### 2.1 Assign confidence on fact extraction

**File:** `mcp-server/src/facts.ts`

In `extractFacts()`, after the LLM returns fact strings, detect first-person
assertions via a simple regex applied to the source memory value:

```typescript
const OBSERVED_PATTERN = /^(we use|the team (uses|adopted)|our \w+ is|we (run|deploy|use))/i;

function assignConfidence(factText: string, memoryValue: string): FactConfidence {
  // Check if the source memory value contains a first-person assertion
  const sentences = memoryValue.split(/[.!?\n]/);
  const factLower = factText.toLowerCase();
  for (const sentence of sentences) {
    if (OBSERVED_PATTERN.test(sentence.trim()) && sentence.toLowerCase().includes(factLower.split(' ')[0])) {
      return 'observed';
    }
  }
  return 'inferred';
}
```

Pass `confidence` to the INSERT in `storeFacts()`.

**Verification:** Write a memory starting with "We use PostgreSQL 15". Extracted
fact about PostgreSQL should have `confidence = 'observed'`. A memory saying
"The system probably uses a caching layer" should produce `confidence = 'inferred'`.

#### 2.2 Revive stale facts on retrieval

**File:** `mcp-server/src/memory-search.ts`

In the same async UPDATE block from Phase 1.2, also update `confidence`:

```typescript
pool.query(
  `UPDATE memory.facts
     SET retrieval_count = retrieval_count + 1,
         last_retrieved_at = now(),
         confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END
   WHERE id = ANY($1::uuid[])`,
  [factIds]
).catch(err => logger.warn('fact retrieval update failed', { err }));
```

`factIds` are the UUIDs of facts included in search results (already in
`MemorySearchResult` as `fact_id` or equivalent).

#### 2.3 Nightly stale confidence decay

**File:** `agent/src/jobs/memory-lifecycle.ts`

Add a `staleConfidenceDecayJob()` function called in the existing daily job
sequence (after `importanceDecayJob`, before `consolidationJob`):

```typescript
async function staleConfidenceDecayJob(pool: Pool): Promise<void> {
  const STALE_THRESHOLD_DAYS = 30;
  await pool.query(`
    UPDATE memory.facts
       SET confidence = 'stale'
     WHERE confidence IN ('observed', 'inferred')
       AND valid_to IS NULL
       AND (
         last_retrieved_at < now() - interval '${STALE_THRESHOLD_DAYS} days'
         OR (last_retrieved_at IS NULL AND created_at < now() - interval '${STALE_THRESHOLD_DAYS} days')
       )
  `);
}
```

Process in batches of 10,000 rows to avoid lock contention (add `LIMIT` +
loop if needed).

#### 2.4 confidence_min parameter on search_memory MCP tool

**File:** `mcp-server/src/index.ts`

Add to the `search_memory` Zod schema:

```typescript
confidence_min: z.enum(['inferred', 'observed', 'verified']).optional()
```

**File:** `mcp-server/src/memory-search.ts`

In the SQL that queries facts, add a WHERE clause when `confidenceMin` is set:

```typescript
const confidenceOrder = { inferred: 0, observed: 1, verified: 2 };
if (confidenceMin) {
  factQuery += ` AND f.confidence IN (${
    Object.entries(confidenceOrder)
      .filter(([, rank]) => rank >= confidenceOrder[confidenceMin])
      .map(([name]) => `'${name}'`)
      .join(', ')
  })`;
}
```

**Verification:** Write 2 facts, one `inferred` and one `observed`. Searching
with `confidence_min="observed"` must return only the observed one.

#### 2.5 Confidence labels in assemble_context output

**File:** `mcp-server/src/context-assembly.ts`

When facts are formatted into the context block, append the confidence label:

```
- [inferred] The system uses a PostgreSQL database.
- [observed] We use Go 1.22 for all services.
- [stale] The API rate limit is 1000/min.
```

Find the fact formatting section (where facts from the `facts` source are
stringified) and append ` [${fact.confidence}]` or prefix with `[${fact.confidence}] `.

---

### Phase 3: Conflict Surfacing (Feature D) — ~0.5 days

This is the quickest win after Phase 1.

#### 3.1 Query recently invalidated facts in context assembly

**File:** `mcp-server/src/context-assembly.ts`

After the primary fact assembly, run a supplementary query:

```sql
SELECT f.fact_text,
       fi.fact_text AS superseded_by_text,
       EXTRACT(DAY FROM now() - f.valid_to) AS days_ago
  FROM memory.facts f
  JOIN memory.facts fi ON fi.id = f.invalidated_by
 WHERE f.valid_to >= now() - interval '7 days'
   AND (f.valid_to - f.valid_from) < interval '14 days'
   AND f.memory_id IN (
       SELECT id FROM memory.memories WHERE agent_id = $agentId
   )
 ORDER BY f.valid_to DESC
 LIMIT 5
```

Format results as:

```
[CONFLICT: "auth-service uses JWT" was superseded 3 days ago by "auth-service uses session cookies"]
```

Append conflict block after current facts section in the output.

**Verification:** Store a fact, then store a contradicting fact so
`invalidateContradictions()` fires. `assemble_context` output must include
the `[CONFLICT: ...]` annotation.

---

### Phase 4: Transfer Scoring (Feature E) — ~0.5 days

#### 4.1 Implement transferScore() utility

**File:** `mcp-server/src/context-assembly.ts`

```typescript
const TRANSFER_BLOCKLIST = ['config', 'deploy', 'url', 'auth', 'secret', 'host', 'password', 'token', 'credential'];
const TRANSFER_ALLOWLIST = ['error', 'pattern', 'rule', 'convention', 'gotcha', 'lesson', 'warning', 'avoid'];

function transferScore(factText: string, key: string): number {
  const combined = `${factText} ${key}`.toLowerCase();
  if (TRANSFER_BLOCKLIST.some(term => combined.includes(term))) return -1;
  if (TRANSFER_ALLOWLIST.some(term => combined.includes(term))) return 0.2;
  return 0;
}
```

#### 4.2 Apply filter to cross-repo facts

In `context-assembly.ts`, find where cross-repo facts are fetched (the section
that iterates `settings.cross_repo_repos`). After fetching, filter:

```typescript
const filteredFacts = crossRepoFacts.filter(f => transferScore(f.fact_text, f.key) > -1);
// Boost allowlisted facts in RRF merge by adjusting their score:
filteredFacts.forEach(f => {
  f.rrfScore = (f.rrfScore ?? 0) + transferScore(f.fact_text, f.key);
});
```

**Verification:** In cross-repo context assembly, a fact about "deploy URL is
https://..." must be excluded. A fact about "convention: avoid mutable global
state" must be included and ranked higher.

---

### Phase 5: Outcome Feedback Loop (Feature F) — ~1 day

This requires Phase 1 (retrieval_count) to be merged first.

#### 5.1 Log memory_keys in assemble_context audit entry

**File:** `mcp-server/src/context-assembly.ts`

When writing to `memory.audit_log` after assembly, include the keys of
memories that were included in the output:

```typescript
// Collect keys from assembled memories
const memoryKeys = assembledMemories.map(m => m.key);

await pool.query(`
  INSERT INTO memory.audit_log (agent_id, operation, metadata)
  VALUES ($1, 'assemble_context', $2)
`, [agentId, JSON.stringify({ query, task_id: taskId, memory_keys: memoryKeys, fact_count: facts.length, latency_ms })]);
```

If `task_id` is not currently passed to `assembleContext()`, add it as an
optional parameter — it's available from the MCP tool call metadata when
invoked from a pipeline task context.

#### 5.2 Apply outcome delta in loretask-watcher.ts

**File:** `agent/src/jobs/loretask-watcher.ts`

Find the `merge-check` handling section. After confirming PR merged or closed,
call a new `applyOutcomeFeedback()` helper:

```typescript
async function applyOutcomeFeedback(
  pool: Pool,
  taskId: string,
  outcome: 'merged' | 'closed'
): Promise<void> {
  const delta = outcome === 'merged' ? 3 : -1;

  const { rows } = await pool.query<{ memory_keys: string[] }>(
    `SELECT (metadata->>'memory_keys')::text[] AS memory_keys
       FROM memory.audit_log
      WHERE operation = 'assemble_context'
        AND metadata->>'task_id' = $1
      LIMIT 1`,
    [taskId]
  );

  if (!rows[0]?.memory_keys?.length) return;

  await pool.query(
    `UPDATE memory.memories
        SET retrieval_count = GREATEST(0, retrieval_count + $1)
      WHERE key = ANY($2)`,
    [delta, rows[0].memory_keys]
  );
}
```

Call `applyOutcomeFeedback` in the existing merge-check handler. Wrap in
`try/catch` to ensure no merge-check failure propagates.

**Verification:** Create a task, assemble context (with `task_id`), simulate
merge signal. Query `memory.memories` — `retrieval_count` on assembled keys
must be +3 higher.

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Retrieval UPDATE contention on hot memories | Medium | Low | Fire-and-forget; use `pg_advisory_lock` if needed |
| Confidence heuristic false-positives on `'observed'` | Low | Medium | Conservative regex; `inferred` is the safe default |
| Stale decay job marks facts too aggressively | Medium | Low | Only affects `inferred`/`observed`; `verified` never decayed |
| Conflict surfacing is noisy (too many annotations) | Low | Medium | Hard limit of 5 per call; 7-day window |
| Transfer scoring blocklist too aggressive | Low | Medium | Only applies to cross-repo; primary repo unaffected |
| audit_log `task_id` missing for older tasks | Low | Medium | `applyOutcomeFeedback` is a no-op when no audit entry found |
| `memory_keys` JSON array too large for long context assemblies | Low | Low | Trim to top-20 keys if array > 50 entries |

## Critical Path

```
Phase 1 (schema + retrieval strengthening)
    └── Phase 2 (confidence tiers)       ← needs retrieval_count on facts
    └── Phase 5 (outcome feedback)       ← needs retrieval_count on memories
Phase 3 (conflict surfacing)             ← independent, can parallelize with Phase 2
Phase 4 (transfer scoring)              ← independent, can parallelize with Phase 2
```

Phases 3 and 4 can be implemented in parallel with Phase 2. Phase 5 should be
last (depends on Phase 1 columns being deployed and the audit_log change from
Phase 5.1).

## Generated Artifacts

- [contracts/db-schema.md](contracts/db-schema.md) — DDL for new columns and indexes
