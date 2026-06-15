# scheduled/ — in-process node-cron jobs

Each `.ts` file here runs **in-process** inside the always-on Floor
container via `node-cron`, registered in
[`agent/src/index.ts`](../../index.ts) with `registerJob(...)`.

These jobs intentionally share the agent's warm state:
- Postgres pool (`db.ts`)
- Octokit client (`platform.ts`)
- Prompt-cache break tracker (`lib/prompt-cache.ts`)
- Webhook trigger endpoints (`health.ts` — e.g. `review-reactor`)

What lives here vs. `cron/`:
- **here**: sub-minute tick rate, hot-path, or webhook-coupled jobs
- **`cron/`**: ≥hourly, heavy, independent batch jobs

See [ADR-019](../../../../adrs/ADR-019-scheduled-job-runtime-split.md) for
the split rationale; see [the spec](../../../../specs/scheduled-job-runtime-split/spec.md)
for the classification table.
