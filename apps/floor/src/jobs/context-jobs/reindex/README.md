# reindex

Nightly (~02:00 UTC). Ingests onboarded repos via Vertex AI embeddings. Seeds
from exact files (CLAUDE.md, AGENTS.md) plus prefixes (`adrs/`, `specs/`,
`.specify/`) on first/empty ingest; thereafter processes only files changed
since `last_ingested_at`. Per file: classify → chunk → embed → upsert into the
repo's team schema (falling back to `org_shared`).

- **Entry point:** `index.ts` → `reindexJob()`
- **Job name:** `context_reindex` — `npm run job -- context_reindex`
- **Tests:** `reindex-seed.test.ts` (covers the pure `selectSeedFiles` helper)
