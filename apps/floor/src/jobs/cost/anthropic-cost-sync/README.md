# anthropic-cost-sync

Syncs Anthropic organization cost and usage from the Admin API (31-day rolling
window) into `pipeline.anthropic_cost_daily`, upserting per-model rows
(input/output tokens, cache creation/read, billed cost). Env-gated on
`ANTHROPIC_ADMIN_KEY` — skips silently when unset.

- **Entry point:** `index.ts` → `anthropicCostSyncJob()`
- **Job name:** `anthropic_cost_sync` — `npm run job -- anthropic_cost_sync`
- **Tests:** `anthropic-cost-sync.test.ts`
