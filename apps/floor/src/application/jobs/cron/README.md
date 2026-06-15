# cron/ — Kubernetes CronJob batch jobs

Each `.ts` file here runs as its own Kubernetes CronJob pod (separate
container), invoked by the generic `dist/job-runner.js` entrypoint.

Schedules and per-job overrides live in
[`terraform/modules/gke-mcp/agent-helm/values.yaml`](../../../../terraform/modules/gke-mcp/agent-helm/values.yaml)
(`cronJobs:` list). The shared manifest is
[`agent-helm/templates/cronjob.yaml`](../../../../terraform/modules/gke-mcp/agent-helm/templates/cronjob.yaml).

These jobs share **no** in-memory state with the Floor Deployment.
Add a new batch job by:

1. Dropping the `.ts` file here.
2. Adding its name → function to the dispatch table in
   [`agent/src/job-runner.ts`](../../job-runner.ts).
3. Appending an entry to `cronJobs:` in `values.yaml` with a schedule
   (and resource/deadline overrides if it's LLM- or embedding-heavy).

On-demand run:
```
kubectl create job --from=cronjob/<name> manual-$(date +%s)
```

## Running locally

The same binary the CronJob pod invokes (`dist/job-runner.js`) is
runnable from a laptop — handy for testing a job against a real DB
before it ships to the cluster.

```bash
cd agent
npm run build

# Single job (npm passes args after --):
npm run job -- spec_test_linker

# All 10 batch jobs sequentially (stops on first failure):
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

A local invocation writes to `pipeline.job_runs` exactly like a
CronJob pod does, so it shows up in the web-ui `/analytics` view
alongside cluster runs.

The fastest dev-loop iteration is:

```bash
cd agent
npm run dev          # tsc --watch in one terminal
npm run job -- spec_drift   # in another, as often as needed
```

See [ADR-019](../../../../adrs/ADR-019-scheduled-job-runtime-split.md) for
the split rationale; see [the spec](../../../../specs/scheduled-job-runtime-split/spec.md)
for the classification table.
