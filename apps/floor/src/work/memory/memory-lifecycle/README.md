# memory-lifecycle

Two related memory-hygiene jobs.

**`importanceDecayJob`** (`importance_decay`) — scores memories by
recency / access / quality and evicts the lowest-scoring beyond the per-agent
cap (500), evicts invalidated facts beyond their cap, and ages facts unretrieved
for 30+ days to `stale`. Logs evictions and transitions to the audit table.

**`consolidationJob`** (`consolidation`) — groups recent facts (7-day lookback)
per repo and uses Haiku to extract higher-level patterns, stored as
`consolidated/{repo}/{timestamp}` memories. Requires `ANTHROPIC_API_KEY`.

- **Entry point:** `index.ts` → `importanceDecayJob()`, `consolidationJob()`
- **Job names:** `importance_decay`, `consolidation`
- **Tests:** `memory-lifecycle.test.ts`
