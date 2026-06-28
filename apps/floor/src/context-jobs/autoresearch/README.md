# autoresearch

Weekly (Mon 06:00 UTC). Mines Langfuse for low-confidence and hallucination
traces, clusters them by namespace, generates three candidate prompt fixes
(direct / example / constraint) per cluster, evaluates them with PromptFoo, and
opens a PR when the best candidate gains ≥2% — otherwise files a gap-fill task
for manual review. Skips silently without Langfuse credentials.

- **Entry point:** `index.ts` → `autoresearchJob()`
- **Job name:** `autoresearch` — `npm run job -- autoresearch`
- **Tests:** —
