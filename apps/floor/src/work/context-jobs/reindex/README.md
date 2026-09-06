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
to a single shared timestamp — spec reassembly orders by
`metadata.chunk_index`, not `ingested_at`), so steady-state nights rewrite
nothing. A failed, empty, or truncated tree fetch skips the pass (no touch, no
prune) — `listTree` throws on GitHub's ~100k-entry truncation rather than let a
partial list read as mass deletion.

Each run also carries two capped repair sweeps: a chunker-upgrade **heal** sweep
re-ingests code files whose stored chunks predate the current `CHUNKER_VERSION`,
and a **backfill** sweep ingests classifier-supported files present in the repo
tree but absent from the chunks table. Both are per-repo, per-run capped
(200 files) so a large gap drains across nights.

- **Entry point:** `index.ts` → `reindexJob()`
- **Job name:** `context_reindex` — `npm run job -- context_reindex`
- **Tests:** `reindex-seed.test.ts` (pure `selectSeedFiles` helper),
  `verify.test.ts` (verification pass against the in-memory chunks double),
  `reindex-heal.test.ts` (chunker-upgrade heal sweep),
  `reindex-backfill.test.ts` (never-ingested backfill sweep)
