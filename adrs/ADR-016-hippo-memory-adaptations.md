---
adr_number: 16
title: "Hippo-memory adaptations — retrieval strengthening, confidence tiers, conflict surfacing, transfer scoring, outcome feedback"
status: accepted
date: 2026-04-20
domains: [memory, agents, pipeline]
---

# ADR-016: Hippo-memory adaptations

## Context

ADR-014 established passive memory capture, importance decay, and
fact consolidation. Six further enhancements were identified from
[kitfunso/hippo-memory](https://github.com/kitfunso/hippo-memory)
to make the memory system self-reinforcing:

1. **Retrieval strengthening** — facts that get used should survive longer.
2. **Confidence tiers** — distinguish human-confirmed facts from
   auto-extracted noise.
3. **Conflict surfacing** — surface contradictions at read time, not
   silently discard.
4. **Transfer scoring** — prevent repo-specific configuration from
   polluting cross-repo context.
5. **Outcome feedback** — merge/reject signals should strengthen or
   weaken contributing memories.
6. **Half-life-aware importance scoring** — replace static age decay
   with the retrieval-adjusted half-life accumulated from (1) and (5).

Tracked in `specs/hippo-memory-adaptations/` and
[re-cinq/lore#205](https://github.com/re-cinq/lore/issues/205).

## Decision

### 1. Schema additions (Phase 1)

**File:** `scripts/infra/setup-memory-schema.sh`

Three new columns on `memory.facts` and `memory.memories`:

```sql
retrieval_count   INT         DEFAULT 0
last_retrieved_at TIMESTAMPTZ
half_life_days    INT         DEFAULT 30   -- facts; 60 for memories
```

Memories get a longer default half-life (60d vs 30d) because they
are explicit agent writes (higher signal) whereas facts are
auto-extracted fragments.

`confidence` column on `memory.facts` with a CHECK constraint:
`verified | observed | inferred | stale`. Default `observed`.

`memory.fact_conflicts` table records each contradiction detection
event (`old_fact_id`, `new_fact_id`, `similarity`, `created_at`)
with indexes on both FK columns.

`context_refs JSONB` column on `pipeline.tasks` to track which
facts and memories contributed to a task's context.

All DDL is idempotent (`IF NOT EXISTS`, `IF NOT EXISTS` on
constraints via `DO $$ BEGIN … EXCEPTION WHEN duplicate_object`).

### 2. Retrieval strengthening (Phase 2)

**File:** `mcp-server/src/memory-search.ts`

`strengthenRetrievals()` runs fire-and-forget after every
`searchMemories()` call. It batch-updates returned facts
and memories:

```sql
-- facts
UPDATE memory.facts
SET retrieval_count   = retrieval_count + 1,
    last_retrieved_at = now(),
    half_life_days    = LEAST(COALESCE(half_life_days, 30) + 2, 365),
    confidence        = CASE WHEN confidence = 'stale'
                             THEN 'observed' ELSE confidence END
WHERE id = ANY($1::uuid[])

-- memories (same shape, different table)
UPDATE memory.memories
SET retrieval_count   = retrieval_count + 1,
    last_retrieved_at = now(),
    half_life_days    = LEAST(COALESCE(half_life_days, 60) + 2, 365)
WHERE key = ANY($1) AND agent_id = ANY($2)
```

To propagate fact IDs, `f.id` and `f.confidence` are now returned
by both `vectorSearchFacts` and `keywordSearchFacts` and included
in `RankedRow` and `MemorySearchResult` as optional fields (`id`,
`confidence`).

Stale facts are revived to `observed` on retrieval — a fact that
comes back into use is no longer stale.

### 3. Confidence tiers (Phase 3)

**File:** `mcp-server/src/facts.ts`

- `extractFacts()` (memory-sourced) sets `confidence = 'inferred'`
  on INSERT — memories are one hop further from raw observation.
- `extractFactsFromEpisode()` (episode-sourced) omits the column,
  inheriting the `observed` default.

**File:** `agent/src/jobs/memory-lifecycle.ts`

Daily decay job transitions unretrieved facts to `stale`:

```sql
UPDATE memory.facts
SET confidence = 'stale'
WHERE confidence NOT IN ('stale', 'verified')
  AND valid_to IS NULL
  AND COALESCE(last_retrieved_at, created_at) < now() - interval '30 days'
```

**File:** `mcp-server/src/context-assembly.ts`

Facts in assembled context are prefixed with their confidence tier
when present (e.g. `[stale] Deployment uses Helm v3.12`). The
`[CONFLICT]` tag is applied separately (see Phase 4).

### 4. Conflict surfacing (Phase 4)

**File:** `mcp-server/src/facts.ts`

`invalidateContradictions()` inserts a row into `memory.fact_conflicts`
before invalidating the old fact. `ON CONFLICT DO NOTHING` prevents
duplicate records for the same pair.

**File:** `mcp-server/src/context-assembly.ts`

When assembling facts, a single query checks whether any returned
fact appears as `new_fact_id` in a conflict record from the last
7 days. Matching facts are prefixed `[CONFLICT]` in the assembled
context. This gives agents visibility into disputed knowledge without
requiring them to query the conflicts table directly.

Note: The implementation uses a simpler `[CONFLICT]` tag rather than
the originally planned `[CONFLICT: replaces "<old_text>"]` form.
The old text was omitted to keep context compact; the full conflict
record is still queryable via SQL if needed.

### 5. Transfer scoring (Phase 5)

**File:** `mcp-server/src/memory-search.ts`

```typescript
const PORTABLE_KEYWORDS = ['error', 'pattern', 'gotcha', 'rule',
  'convention', 'best-practice', 'anti-pattern', 'migration'];
const LOCAL_KEYWORDS = ['config', 'deploy', 'url', 'auth',
  'secret', 'env', 'port', 'hostname', 'endpoint', 'cron'];

export function computeTransferScore(text: string): number {
  let score = 0.5;
  for (const kw of PORTABLE_KEYWORDS) if (lower.includes(kw)) score += 0.15;
  for (const kw of LOCAL_KEYWORDS)    if (lower.includes(kw)) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}
```

**File:** `mcp-server/src/context-assembly.ts`

In the `cross_repo` source handler, results with
`computeTransferScore(r.value) < 0.5` are filtered out before
inclusion. This prevents repo-specific configuration (URLs, secrets,
ports) from appearing in other repos' context while allowing
patterns, gotchas, and conventions to flow freely.

### 6. Outcome feedback loop (Phase 6) — PARTIALLY WIRED

**File:** `mcp-server/src/context-assembly.ts`

`assembleContext()` accepts an optional `includeIds: boolean`
parameter. When true, it collects `fact_ids` and `memory_ids` from
all returned results and returns them as a `context_refs` field.

**File:** `mcp-server/src/pipeline.ts`

`createTask()` accepts `contextRefs?: { fact_ids: string[]; memory_ids: string[] }`
and stores it to `pipeline.tasks.context_refs` via a follow-up UPDATE.

**File:** `agent/src/jobs/merge-check.ts`

On PR merge, the job reads `context_refs` from the task and extends
`half_life_days` by +5 (capped at 365) on contributing facts and
memories. On PR rejection (closed without merge), it penalises by -3
(floor at 7). Both outcomes write an audit log entry.

**Known gap:** The `/api/context` handler in `routes.ts` calls
`assembleContext()` without `includeIds: true`, so `context_refs`
is never populated on task creation. The merge-check feedback path
reads null refs and silently no-ops. To close this gap, the
`/api/context` handler must be updated to pass `includeIds: true`
and the `/api/task` POST handler must forward `result.context_refs`
to `createTask()`. All the machinery is in place; only the wiring
call is missing.

### 7. Half-life-aware importance scoring (Phase 7)

**File:** `agent/src/jobs/memory-lifecycle.ts`

`scoreImportance()` now uses the half-life decay model:

```typescript
const halfLife       = memory.half_life_days || 60;
const lastActive     = memory.last_retrieved_at || memory.created_at;
const daysSinceActive = (Date.now() - new Date(lastActive).getTime()) / 86_400_000;
const strength       = Math.pow(0.5, daysSinceActive / halfLife);
// strength (0-1) mapped to a -5 to +2 modifier:
score += Math.round(strength * 7) - 5;
```

Additional modifiers (unchanged from ADR-014):
- Content length: short (<50 chars) -2, long (>500 chars) +1
- Key patterns: `gotcha`/`decision` +2, `convention`/`pattern` +2,
  `auto-curation`/`session-summary` -1
- Retrieval count: ≥20 +2, ≥5 +1 (new)
- Stale confidence: -1 (new)

The candidate query now selects `last_retrieved_at`, `half_life_days`,
and `retrieval_count` for all memories in scope.

## Consequences

**Positive:**
- Frequently used facts persist longer without manual curation.
- Low-confidence and stale facts are visibly annotated rather than
  silently present.
- Contradictions surface at read time so agents can reason about
  disputed knowledge.
- Cross-repo context stays portable; local config stays local.
- Merged PRs reinforce the context that contributed to their success.
- Importance scoring is dynamic — retrieval history shapes eviction
  decisions.

**Negative:**
- Every `search_memory` call issues one async DB write (retrieval
  strengthening). Under high search load this adds write pressure.
  Monitor with OTEL counter `memory.retrieval_strength.updated`.
- `context_refs` outcome feedback is currently inert (see Phase 6
  gap above). Until the wiring is added, merge/reject signals have
  no effect.
- Transfer scoring keyword list is heuristic. False positives
  (portable facts blocked) and false negatives (local facts passed)
  will occur. Iterate based on cross-repo episode feedback.

## Operational notes

- **Schema migration:** `setup-memory-schema.sh` is idempotent. Re-run
  is safe. New columns default to 0 / NULL / `observed` — existing rows
  behave identically to before until first retrieval or feedback event.
- **Confidence backfill:** Existing facts remain `observed`. No
  backfill needed; the tier only matters for freshly extracted facts.
- **Phase 6 fix:** See gap description above. One-line change in
  `routes.ts` assembleContext call + forwarding contextRefs in the
  task creation path.

## Relationship to other ADRs

- Extends [ADR-014](ADR-014-passive-memory-capture.md): adds
  retrieval strengthening and outcome feedback to the decay model
  established there.
- The half-life columns (`half_life_days`, `retrieval_count`) are
  the mechanism by which ADR-015's prompt-cache cost savings compound
  over time — high-quality context is retained longer, reducing
  re-extraction calls.
