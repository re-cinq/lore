# ttl-cleanup

Soft-deletes expired memories from `memory.memories` (rows with
`expires_at < now()` that are not already deleted) and returns the count cleaned.

- **Entry point:** `index.ts` → `ttlCleanupJob()`
- **Job name:** `memory_ttl` — `npm run job -- memory_ttl`
- **Tests:** `ttl-cleanup.test.ts`
