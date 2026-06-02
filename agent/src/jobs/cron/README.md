# cron/ — Kubernetes CronJob batch jobs

Each `.ts` file here runs as its own Kubernetes CronJob pod (separate
container), invoked by the generic `dist/job-runner.js` entrypoint.

Schedules and per-job overrides live in
[`terraform/modules/gke-mcp/agent-helm/values.yaml`](../../../../terraform/modules/gke-mcp/agent-helm/values.yaml)
(`cronJobs:` list). The shared manifest is
[`agent-helm/templates/cronjob.yaml`](../../../../terraform/modules/gke-mcp/agent-helm/templates/cronjob.yaml).

These jobs share **no** in-memory state with the `lore-agent` Deployment.
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

See [ADR-019](../../../../adrs/ADR-019-scheduled-job-runtime-split.md) for
the split rationale; see [the spec](../../../../specs/scheduled-job-runtime-split/spec.md)
for the classification table.
