# reindex

Nightly (~02:00 UTC). Ingests onboarded repos via Vertex AI embeddings. Seeds
from exact files (CLAUDE.md, AGENTS.md) plus prefixes (`adrs/`, `specs/`,
`.specify/`) on first/empty ingest; thereafter processes only files changed
since `last_ingested_at`. Per file: classify → chunk → embed → upsert into the
repo's team schema (falling back to `org_shared`).

Every run ends with a verification pass (`verify.ts`): reindex-owned chunks
(`metadata->>'ingested_by' = 'reindex-job'`) whose files still exist in the
repo tree get `ingested_at` re-stamped; orphans of deleted files are pruned.
This keeps gap-detect's `staleChunkCount` clearable — a non-zero count means
reindex has not verified the repo in that window, not that files are unchanged.
Re-stamping is gated to files unverified for 30+ days (whole files at a time,
preserving within-file order), so steady-state nights rewrite nothing. A
failed, empty, or truncated tree fetch skips the pass (no touch, no prune) —
`listTree` throws on GitHub's ~100k-entry truncation rather than let a partial
list read as mass deletion.

- **Entry point:** `index.ts` → `reindexJob()`
- **Job name:** `context_reindex` — `npm run job -- context_reindex`
- **Tests:** `reindex-seed.test.ts` (pure `selectSeedFiles` helper),
  `verify.test.ts` (verification pass against the in-memory chunks double)
