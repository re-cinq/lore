# context-core-builder

Nightly (04:00 UTC, after eval-runner). For each namespace with chunks, runs a
PromptFoo eval against the current chunk collection and compares to the previous
production score: promotes on ≥2% gain, rejects on >5% regression (filing an
alert task), else marks unchanged. Records every outcome in
`pipeline.context_core_history`.

- **Entry point:** `index.ts` → `contextCoreBuilderJob()`
- **Job name:** `context_core_builder` — `npm run job -- context_core_builder`
- **Tests:** —
