# gap-detect

Audits every onboarded repo for missing or stale context — no CLAUDE.md, no
ADRs, no specs, chunks older than 90 days, and (when configured) low-confidence
Langfuse traces — and files one deduped gap-fill task per detected gap.

- **Entry point:** `index.ts` → `gapDetectJob()`
- **Job name:** `gap_detection` — `npm run job -- gap_detection`
- **Tests:** —
