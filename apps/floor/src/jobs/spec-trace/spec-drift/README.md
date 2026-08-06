# spec-drift

Spec-drift detection flags specs that have diverged from the code they describe
and files a gap-fill task to reconcile them.

**The detection job itself no longer lives in this folder.** It moved to
`libs/shared/src/detect/spec-drift.ts` (with its pure decision helpers in
`libs/shared/src/detect/spec-drift-rules.ts`) so the Floor and the `lore-station`
detect pod can share one implementation. It runs as the `detect` node of the
`spec-drift` assembly line (`libs/assembly-lines/src/assembly-lines/spec-drift.yaml`),
fanned out weekly (Mondays, 10:00 UTC) per active repo by the `cron.spec_drift.tick`
handler — not as a batch job on the `job-runner` dispatch table. The fan-out
(`apps/floor/src/jobs/detect/fan-out.ts`) is what skips repos with no code-chunk
activity in the last 7 days.

Per spec, drift is decided two ways:

1. **Graph-primary** — when the spec is projected into the spec-trace graph,
   from per-statement `violated` / `drifted` flags (deterministic, no LLM).
   Authoritative when present.
2. **Heuristic fallback** — LLM-extract testable assertions, match top-level
   symbol kinds against AST `symbol_name` chunks, and flag past the divergence
   threshold **and** an absolute miss floor.

It files one deduped gap-fill task per drifted spec, capped at 3 tasks per repo
per run.

## What is in this folder

This folder now holds only the drift-issue guidance module used when composing
the gap-fill issue body:

- `drift-issue-guidance.ts` — static guidance block (`DRIFT_ISSUE_GUIDANCE`) plus
  the `isDriftTask` predicate, appended to drift issues *after* the LLM copy pass
  (which compresses the body and strips trailers). Imported by
  `apps/floor/src/jobs/task/issue-body.ts`.
- `drift-issue-guidance.test.ts` — its colocated tests.
