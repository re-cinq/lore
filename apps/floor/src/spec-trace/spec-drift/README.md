# spec-drift

Weekly. For each spec, decides drift two ways:

1. **Graph-primary** — when the spec is projected into the spec-trace graph,
   from per-statement `violated` / `drifted` flags (deterministic, no LLM).
   Authoritative when present.
2. **Heuristic fallback** — LLM-extract testable assertions, match top-level
   symbol kinds against AST `symbol_name` chunks, and flag past the divergence
   threshold **and** an absolute miss floor.

Skips repos with no code-chunk activity in the last 7 days, and files one deduped
gap-fill task per drifted spec (per-run cap 10).

- **Entry point:** `index.ts` → `specDriftJob()`
- **Job name:** `spec_drift` — `npm run job -- spec_drift`
- **Tests:** `spec-drift-rules.test.ts`, `drift-issue-guidance.test.ts`

## Also in this folder
- `spec-drift-rules.ts` — pure decision helpers (`isAssertionSource`,
  `shouldSkipDrift`, `decideGraphDrift`, `decideHeuristicDrift`). Also imported
  by `spec-coverage-backfill` for `isAssertionSource`.
- `drift-issue-guidance.ts` — static guidance block + `isDriftTask` predicate
  appended to drift issues. Also imported by
  `application/task-processing/issue-body.ts`.
