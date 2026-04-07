# Feature Specification: Hippo-Memory Adaptations

| Field      | Value                                                                  |
|------------|------------------------------------------------------------------------|
| Feature    | Hippo-Memory Adaptations                                               |
| Status     | Draft                                                                  |
| Created    | 2026-04-07                                                             |
| Owner      | Platform Engineering                                                   |
| Priority   | P1 (A, B) / P2 (C, D, E, F)                                           |
| Motivation | [re-cinq/lore#205](https://github.com/re-cinq/lore/issues/205), [Research](research.md) |
| Depends on | [Temporal Fact Invalidation](../temporal-fact-invalidation/spec.md) (shipped), [ADR-014](../../adrs/ADR-014-passive-memory-capture.md) (shipped) |

## Problem Statement

Lore's memory system captures facts and memories but treats retrieval
as a read-only, side-effect-free operation. This creates three gaps:

1. **Retrieval has no influence on importance.** The daily decay job
   scores memories by age and content length, but not by how often
   they're actually used. A memory recalled daily looks the same as
   one never touched. Valuable working knowledge gets evicted at the
   same rate as stale trivia.

2. **All facts have equal epistemic standing.** Lore has temporal
   validity (`valid_to`) but not confidence. A fact directly observed
   ("we use Go 1.22") and a fact inferred by the LLM ("probably uses
   a microservices pattern") look identical in search results. Agents
   cannot calibrate trust.

3. **Conflict resolution is invisible.** When `invalidateContradictions()`
   detects a superseded fact, it silently sets `valid_to`. The agent
   that triggered the write never sees what was displaced. Context
   assembly presents only current facts with no indication that
   something changed recently.

## Vision

Memory that learns from usage. Frequently-retrieved knowledge stays
alive longer. Facts carry confidence labels that degrade without use
and revive on retrieval. When facts conflict, the context surface
shows the tension rather than hiding it. Cross-repo knowledge sharing
filters for portable insights. PR outcomes feed back into importance
scores.

## User Scenarios & Acceptance Criteria

### Scenario 1: Retrieval Strengthening

**Actor:** Agent searching memory repeatedly for the same concept

**Flow:**
1. Agent calls `search_memory("deployment process")` every session.
2. The three top-ranked memories are returned.
3. Their `retrieval_count` increments and `last_retrieved_at` updates.
4. At next importance decay run, these memories score higher than
   same-age memories that were never retrieved.
5. They survive eviction while less-used memories of similar age
   are evicted first.

**Acceptance Criteria:**
- `retrieval_count` and `last_retrieved_at` are updated async on
  every `search_memory` call for returned results.
- `scoreImportance()` incorporates `retrieval_count` and
  `last_retrieved_at` as positive signals.
- Memories with `retrieval_count >= 5` receive a +1 score bonus.
- The UPDATE does not block the response (fire-and-forget).

### Scenario 2: Epistemic Confidence Tiers

**Actor:** Agent consuming `search_memory` results

**Flow:**
1. Agent writes a memory. Fact extraction runs. Facts are stored
   with `confidence = 'inferred'` (LLM-extracted) or `'observed'`
   (directly asserted in memory value).
2. Later, the same fact is retrieved. Its confidence revives if it
   was `'stale'` → `'observed'`.
3. After 30 days without retrieval, the nightly job transitions it
   to `'stale'`.
4. Agent can filter `search_memory` by `confidence_min` to exclude
   inferred or stale facts.
5. `assemble_context` shows confidence next to fact text.

**Acceptance Criteria:**
- `memory.facts` has a `confidence` column with `CHECK` constraint.
- New facts from `extractFacts()` default to `'inferred'`.
- Directly stated facts (detected by heuristic) use `'observed'`.
- Nightly job transitions unretrieved facts to `'stale'` after 30 days.
- Retrieval revives `'stale'` facts to `'observed'`.
- `search_memory` accepts `confidence_min` param
  (`inferred | observed | verified`).
- `assemble_context` output includes confidence label per fact.

### Scenario 3: Conflict Surfacing

**Actor:** Agent calling `assemble_context`

**Flow:**
1. A fact about "auth-service uses JWT" was stored and active.
2. A new memory added "auth-service migrated to session cookies."
3. `invalidateContradictions()` ran and set `valid_to` on the JWT
   fact.
4. Next `assemble_context` call includes a conflict annotation:
   `[CONFLICT: "auth-service uses JWT" was superseded 3 days ago]`.
5. Agent is aware of the recent change and can reason accordingly.

**Acceptance Criteria:**
- `assemble_context` fetches facts invalidated within the last 7
  days that were younger than 14 days at invalidation time.
- These are formatted as `[CONFLICT: "<old fact>" was superseded
  <N> days ago by "<new fact>"]`.
- At most 5 conflict annotations per context assembly call.
- No conflict annotations for older invalidations (reduces noise).

### Scenario 4: Transfer Scoring for Cross-Repo Facts

**Actor:** Agent in repo A, with cross-repo links to repo B

**Flow:**
1. Repo B has 20 facts stored. Some are portable
   (convention patterns, error patterns), some are environment-specific
   (deploy URLs, secrets, host configs).
2. `assemble_context` for repo A fetches cross-repo facts from B.
3. Environment-specific facts are filtered out or ranked lower.
4. Only portable facts (containing `error`, `pattern`, `rule`,
   `convention`, `gotcha`) appear in repo A's context.

**Acceptance Criteria:**
- Cross-repo fact retrieval in `context-assembly.ts` applies a
  transfer score filter.
- Facts whose text or key contains blocklist terms
  (`config`, `deploy`, `url`, `auth`, `secret`, `host`) are excluded.
- Facts whose text or key contains allowlist terms
  (`error`, `pattern`, `rule`, `convention`, `gotcha`) receive +0.2
  RRF score boost.
- No change to same-repo fact retrieval.

### Scenario 5: Outcome Feedback Loop

**Actor:** `merge-check` job after a PR is merged or closed

**Flow:**
1. A Lore task creates a PR. Context was assembled at task start
   (recorded in `assemble_context` audit log with `task_id`).
2. PR is merged. `merge-check` job fires.
3. Job identifies memory keys that appeared in the assembled context
   for this task (via audit log join).
4. Those memories' `retrieval_count` is incremented by +3.
5. If PR was closed without merge, `-1` delta applied instead.

**Acceptance Criteria:**
- `merge-check` job queries `memory.audit_log` for `assemble_context`
  calls associated with the task's `task_id`.
- Extracts referenced memory keys from the audit log payload.
- Applies retrieval count delta via async UPDATE.
- Delta values: `+3` for merge, `-1` for close-without-merge.
- No-op if no matching audit log entries found.

## Functional Requirements

### FR-1: Retrieval Strengthening

- FR-1.1: Add `last_retrieved_at TIMESTAMPTZ` to `memory.memories`.
- FR-1.2: Add `retrieval_count INTEGER NOT NULL DEFAULT 0` to
  `memory.memories`.
- FR-1.3: After building `results` in `searchMemories()`, fire an
  async UPDATE on returned memory IDs. Must not await.
- FR-1.4: `scoreImportance()` adds `+1` if `retrieval_count >= 5`
  and `+1` if `last_retrieved_at` is within 7 days.

### FR-2: Epistemic Confidence Tiers

- FR-2.1: Add `confidence TEXT NOT NULL DEFAULT 'inferred'` to
  `memory.facts` with `CHECK (confidence IN ('verified', 'observed',
  'inferred', 'stale'))`.
- FR-2.2: `extractFacts()` in `facts.ts` sets `confidence = 'inferred'`
  for all LLM-extracted facts.
- FR-2.3: Facts whose source sentence in the memory value begins with
  a first-person assertion ("We use", "The team uses", "Our X is")
  are stored with `confidence = 'observed'`.
- FR-2.4: Add `confidence_min` parameter to `search_memory` MCP tool.
  Valid values: `'inferred'` (default, all facts), `'observed'`
  (excludes inferred), `'verified'` (only verified).
- FR-2.5: Nightly job transitions facts with `last_retrieved_at < now() - 30 days`
  OR `last_retrieved_at IS NULL AND created_at < now() - 30 days` to
  `confidence = 'stale'` (skips `verified` facts).
- FR-2.6: On retrieval, update `confidence = 'observed'` for any
  `'stale'` facts in results (same async UPDATE as FR-1.3).
- FR-2.7: `assemble_context` output includes `[confidence]` label
  next to each fact line.

### FR-3: Conflict Surfacing

- FR-3.1: In `context-assembly.ts`, after assembling current facts,
  run a secondary query for recently invalidated facts.
- FR-3.2: Filter: `valid_to >= now() - interval '7 days'` AND
  `(valid_to - valid_from) < interval '14 days'` (recently active,
  recently superseded).
- FR-3.3: Format as: `[CONFLICT: "<fact_text>" was superseded
  <N> days ago]`.
- FR-3.4: Limit to 5 conflict entries per assembly call.
- FR-3.5: Conflict entries are appended after current facts, not
  mixed in.

### FR-4: Transfer Scoring

- FR-4.1: Implement `transferScore(fact: string, key: string): number`
  in `context-assembly.ts`.
- FR-4.2: Returns `-1` if fact or key contains any of:
  `config`, `deploy`, `url`, `auth`, `secret`, `host`, `password`,
  `token`, `credential`.
- FR-4.3: Returns `+0.2` if fact or key contains any of:
  `error`, `pattern`, `rule`, `convention`, `gotcha`, `lesson`,
  `warning`, `avoid`.
- FR-4.4: Returns `0` otherwise.
- FR-4.5: Applied only to facts sourced from cross-repo context
  (non-primary repo). Facts scoring `-1` are excluded entirely.

### FR-5: Outcome Feedback Loop

- FR-5.1: `merge-check` job queries `memory.audit_log WHERE
  operation = 'assemble_context' AND metadata->>'task_id' = $1`.
- FR-5.2: Extracts `memory_keys` array from the audit log
  `metadata` JSONB field.
- FR-5.3: Applies `UPDATE memory.memories SET retrieval_count =
  retrieval_count + $delta WHERE key = ANY($keys)` asynchronously.
- FR-5.4: Delta: `+3` for merged PR, `-1` for closed-without-merge.
- FR-5.5: `assemble_context` must log referenced memory keys to
  `metadata` in the audit log entry.

## Non-Functional Requirements

### NFR-1: Performance

- Retrieval strengthening UPDATE must be fire-and-forget, adding
  < 5ms to `search_memory` response time.
- Confidence tier nightly job processes at most 10,000 facts per
  run to avoid lock contention.
- Transfer scoring is computed in-memory at query time; no DB writes.

### NFR-2: Backward Compatibility

- All new `search_memory` parameters are optional with defaults
  matching current behavior.
- `assemble_context` confidence labels are additive; format change
  is minor (appended tag, not restructured output).
- All schema changes use `ADD COLUMN IF NOT EXISTS` for idempotent
  re-runs.

### NFR-3: Fail-Open

- Confidence tier decay, outcome feedback, and retrieval strengthening
  all fail silently with a logged warning. They must never block
  primary read/write operations.

## Scope Boundaries

### In Scope

- Features A–F as described (retrieval strengthening, confidence
  tiers, conflict surfacing, transfer scoring, outcome feedback).
- Schema migrations for `memory.memories` and `memory.facts`.
- Updates to `scoreImportance()` in `memory-lifecycle.ts`.
- Updates to `assemble_context` output format (confidence labels,
  conflict annotations).
- `search_memory` parameter additions (`confidence_min`).
- `merge-check` job outcome signal wiring.

### Out of Scope

- Manual fact confidence override via MCP tool (future).
- `confidence = 'verified'` promotion pipeline (future — requires
  human or authoritative source signal).
- Multi-hop transfer scoring (v1 uses keyword heuristics only).
- Structured session handoffs / working memory layer (separate spec).
- Changes to cross-repo link management UI.

## Data Model Changes

See [contracts/db-schema.md](contracts/db-schema.md).

## Dependencies

- Temporal fact invalidation (shipped) — `valid_from`, `valid_to`,
  `invalidated_by` already on `memory.facts`.
- ADR-014 passive memory capture (shipped) — `memory.audit_log`
  already populated by `assemble_context` calls.
- Retrieval strengthening (FR-1) is a prerequisite for the outcome
  feedback loop (FR-5) — both write `retrieval_count`.

## Success Criteria

1. A memory retrieved 5+ times in the past 7 days survives an
   eviction cycle that removes an equal-age unaccessed memory.
2. `search_memory(confidence_min="observed")` returns zero
   `'inferred'` or `'stale'` facts.
3. `assemble_context` includes at least one `[CONFLICT]` annotation
   when a fact was superseded within the past 7 days.
4. Cross-repo context contains no facts whose text matches the
   transfer scoring blocklist.
5. After a PR merge, the memories from its assembled context have
   higher `retrieval_count` than memories from a closed-without-merge
   task of comparable age.
6. All new schema columns are idempotently added (safe to re-run
   `setup-memory-schema.sh`).
