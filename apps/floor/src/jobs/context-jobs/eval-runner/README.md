# eval-runner

Nightly (03:00 UTC, after reindex). Discovers team PromptFoo configs under
`evals/`, runs each, logs results to `pipeline.eval_runs`, and files a gap-fill
task when pass rate drops >5% from the previous run. Skips gracefully if
`promptfoo` or the evals directory is absent.

- **Entry point:** `index.ts` → `evalRunnerJob()`
- **Job name:** `eval_runner` — `npm run job -- eval_runner`
- **Tests:** —
