# cron/ — Kubernetes CronJob batch jobs

Each job lives in **its own folder** here, with an `index.ts` entry point (the
job handler), its implementation + helpers + colocated tests, and a `README.md`
describing what it does. Every job runs as its own Kubernetes CronJob pod
(separate container), invoked by the generic `dist/job-runner.js` entrypoint.

These jobs share **no** in-memory state with the Floor Deployment.

## Jobs

| Folder | Job name(s) | What it does |
|---|---|---|
| [anthropic-cost-sync](anthropic-cost-sync/) | `anthropic_cost_sync` | Sync Anthropic org cost/usage into `pipeline.anthropic_cost_daily`. |
| [autoresearch](autoresearch/) | `autoresearch` | Mine Langfuse traces → eval candidate prompt fixes → PR. |
| [context-core-builder](context-core-builder/) | `context_core_builder` | Promote/reject the chunk collection by eval score. |
| [eval-runner](eval-runner/) | `eval_runner` | Run team PromptFoo evals; flag pass-rate drops. |
| [gap-detect](gap-detect/) | `gap_detection` | File gap-fill tasks for missing/stale context. |
| [memory-lifecycle](memory-lifecycle/) | `importance_decay`, `consolidation` | Decay/evict memories; consolidate facts into patterns. |
| [reindex](reindex/) | `context_reindex` | Vertex-embed onboarded repos (seed + incremental). |
| [spec-coverage-backfill](spec-coverage-backfill/) | `spec_coverage_backfill` | Backfill inline spec→test `([validated by …])` links. |
| [spec-drift](spec-drift/) | `spec_drift` | Detect spec/code drift → gap-fill tasks. |
| [ttl-cleanup](ttl-cleanup/) | `memory_ttl` | Soft-delete expired memories. |

> `spec_coverage_validate` is also dispatched by the runner but lives in the
> sibling [`../scheduled/`](../scheduled/) dir (it is webhook/post-ingest
> coupled, not a standalone cron).

Schedules and per-job overrides live in
[`floor-helm/values.yaml`](../../../../../../infra/terraform/modules/gke-mcp/floor-helm/values.yaml)
(`cronJobs:` list). The shared manifest is
[`floor-helm/templates/cronjob.yaml`](../../../../../../infra/terraform/modules/gke-mcp/floor-helm/templates/cronjob.yaml).

## Adding a new job

1. Create a folder `cron/<job>/` with:
   - `<job>.ts` — the handler `export async function <name>Job(): Promise<string>`.
   - `index.ts` — `export { <name>Job } from "./<job>.js";` (the entry point).
   - `README.md` — what the job does, cadence, entry point, tests.
2. Register its name → handler in the dispatch table in
   [`delivery/job-runner.ts`](../../../delivery/job-runner.ts), importing from
   `../application/jobs/cron/<job>/index.js`.
3. Append an entry to `cronJobs:` in `floor-helm/values.yaml` with a schedule
   (and resource/deadline overrides if it's LLM- or embedding-heavy).

On-demand run:
```
kubectl create job --from=cronjob/<name> manual-$(date +%s)
```

## Running locally

The same binary the CronJob pod invokes (`dist/job-runner.js`) runs from a
laptop — handy for testing a job against a real DB before it ships.

```bash
cd apps/floor
npm run build

# Single job (npm passes args after --):
npm run job -- spec_drift

# All batch jobs sequentially (stops on first failure):
npm run jobs:all
```

Required env (point at a reachable Postgres + provide LLM/GitHub creds):

```
LORE_DB_HOST, LORE_DB_PORT, LORE_DB_NAME, LORE_DB_USER, LORE_DB_PASSWORD
ANTHROPIC_API_KEY
GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID
LORE_LOG_BUCKET     # optional; without it the run record is written
                     # but the GCS log upload is a best-effort no-op.
```

A local invocation writes to `pipeline.job_runs` exactly like a CronJob pod, so
it shows up in the web-ui `/analytics` view alongside cluster runs.

Fastest dev-loop iteration:

```bash
cd apps/floor
npm run dev          # tsc --watch in one terminal
npm run job -- spec_drift   # in another, as often as needed
```

See [ADR-019](../../../../../../adrs/ADR-019-scheduled-job-runtime-split.md) for
the split rationale; see
[the spec](../../../../../../specs/scheduled-job-runtime-split/spec.md) for the
classification table.
