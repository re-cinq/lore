# Feature Specification: Scheduled Job Runtime Split

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Scheduled Job Runtime Split (in-process ↔ K8s CronJob) |
| Status   | Shipped                                         |
| Created  | 2026-06-02                                    |
| Owner    | Platform Engineering                          |
| ADR      | [ADR-019](../../adrs/ADR-019-scheduled-job-runtime-split.md) |
| Supersedes | Scheduling portion of [5-lore-agent](../5-lore-agent/spec.md) (Problem #5, FR-6, SC#2) |

## Problem Statement

[Spec 5-lore-agent](../5-lore-agent/spec.md) deliberately consolidated all
periodic work into a single in-process `node-cron` scheduler inside the
always-on `lore-agent` process. Its Problem #5 framed "scattered scheduling
across K8s CronJobs and MCP polling loops" as the defect; its Vision promised to
"run all scheduled maintenance jobs from one place"; FR-6 defined the in-process
scheduler; and Success Criterion #2 required the jobs run **"without K8s CronJob
configuration."** That was the right call **for the 5 jobs that existed then**.

The agent now registers **16** jobs (`agent/src/index.ts`), and they fall into
two profiles the single in-process scheduler serves equally badly at the heavy
end:

- **Hot-path ticks** — `merge_check`, `approval_check`, `loretask_watcher`,
  `spec_task_executor` run `*/1 * * * *`; `review_reactor` / `stale_task_check`
  are frequent safety nets. These belong in-process: a pod-per-tick is pure
  churn, and several are coupled to the agent's webhook trigger endpoints and
  warm in-memory state (DB pool, Octokit client, prompt-cache break tracker).
- **Heavy batch jobs** — `context_reindex`, `gap_detection`, `spec_drift`,
  `spec_test_linker`, `eval_runner`, `context_core_builder`, `autoresearch`,
  `memory_ttl`, `importance_decay`, `consolidation` run weekly/daily, are
  LLM-cost-spiky and long, and share none of the warm state.

Running the heavy batch jobs in-process has concrete costs:

1. **Single-replica pin.** In-process crons double-fire on a second replica
   (no leader election), so `lore-agent` is stuck at `replicas: 1` — no HA.
2. **Missed-run catch-up is app-bespoke and single-pod-bound.** The scheduler
   has a `checkMissedRuns()` that, *at startup*, re-runs a job whose last
   `pipeline.job_runs` entry predates its previous scheduled tick — but it only
   fires when the single agent pod comes back, and it is custom code rather than
   a platform guarantee. K8s `startingDeadlineSeconds` provides the same
   catch-up natively and independently of the agent's lifecycle.
3. **No isolation.** A long LLM-heavy batch run shares CPU/memory with the
   webhook hot path; a hang or memory spike degrades trigger handling.
4. **No independent controls.** No per-job retry/backoff, timeout, concurrency
   policy, resource limits, per-run pod logs, or run history.
5. **No on-demand trigger.** Re-running a job today requires `kubectl exec`-ing
   into the agent pod and invoking the compiled module by hand.

## Solution

A **hybrid runtime split**, recorded in [ADR-019](../../adrs/ADR-019-scheduled-job-runtime-split.md):

- **Keep in-process** (the agent's `node-cron` scheduler): sub-minute,
  hot-path, and webhook-coupled jobs.
- **Move heavy/infrequent batch jobs to Kubernetes CronJobs** — each runs in its
  own pod via a generic `job-runner` CLI entrypoint on the existing agent image,
  scheduled by templated Helm CronJob manifests.
- **Signal the split structurally**: `agent/src/jobs/scheduled/` (in-process) vs
  `agent/src/jobs/cron/` (K8s CronJob), each with a `README.md` stating the
  runtime and container so the difference is obvious from the tree.

The structured split is the point: each batch job gets isolation, its own
resource/retry/timeout/history controls, `startingDeadlineSeconds` catch-up,
per-run pod logs, and a free `kubectl create job --from=cronjob/<name>` manual
trigger — without disturbing the in-process jobs that genuinely benefit from the
resident process.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Split axis | **Cadence + coupling**: sub-minute / hot-path / webhook-coupled → in-process; ≥hourly, heavy, independent → CronJob | Matches where the cost actually is; avoids pod-per-minute churn |
| Runner | **One generic `job-runner` CLI** (`node dist/job-runner.js <jobName>`), reusing the `runner-cli.ts` pattern | One image, one dispatch table; no per-job entrypoint or image |
| Image | **Reuse the agent image** (already baked `/app/dist`) | No new build; CronJob overrides `command`, Deployment unchanged |
| Helm | **One templated `cronjob.yaml`** looping a `cronJobs` values list; env via a shared `_env.tpl` reused by the Deployment | DRY — CronJob and Deployment env can't drift |
| CronJob policy | `concurrencyPolicy: Forbid`, `startingDeadlineSeconds`, `successfulJobsHistoryLimit`/`failedJobsHistoryLimit`, `restartPolicy: Never` + `backoffLimit` | Matches the old "jobs don't overlap" rule (5-lore-agent SC) and adds missed-run catch-up |
| Pod resources | Mandatory `requests` + `limits` + `activeDeadlineSeconds` per CronJob; default in values, per-job overridable | Heavy LLM/embedding jobs must be bounded and time-capped; the agent's 512Mi is too small for some — no unbounded pods |
| Folder reorg | `jobs/cron/` + `jobs/scheduled/`, each with a `README.md` | Structural, obvious signal of runtime/container per the request |
| Cutover | Remove each migrated job's `registerJob` line in the **same release** that adds its CronJob | No window where a job runs twice or not at all |

### Job classification

| Job | Schedule | Runtime | Folder |
|-----|----------|---------|--------|
| `context_reindex` | `0 2 * * *` | **CronJob** | `cron/` |
| `eval_runner` | `0 3 * * *` | **CronJob** | `cron/` |
| `context_core_builder` | `0 4 * * *` | **CronJob** | `cron/` |
| `importance_decay` | `0 5 * * *` | **CronJob** | `cron/` |
| `consolidation` | `30 5 * * *` | **CronJob** | `cron/` |
| `autoresearch` | `0 6 * * 1` | **CronJob** | `cron/` |
| `gap_detection` | `0 9 * * 1` | **event-driven assembly line** (2026-07 amendment) | `jobs/detect/` |
| `spec_drift` | `0 10 * * 1` | **event-driven assembly line** (2026-07 amendment) | `jobs/detect/` |
| `spec_test_linker` | `0 11 * * 1` | **event-driven assembly line** (2026-07 amendment; split into `spec_coverage_validate` daily + `spec_coverage_backfill` weekly by spec-test-coverage v3) | `jobs/detect/` |
| `memory_ttl` | `0 * * * *` | **CronJob** | `cron/` |
| `merge_check` | `*/1 * * * *` | in-process | `scheduled/` |
| `approval_check` | `*/1 * * * *` | in-process | `scheduled/` |
| `loretask_watcher` | `*/1 * * * *` | in-process | `scheduled/` |
| `spec_task_executor` | `*/1 * * * *` | in-process | `scheduled/` |
| `review_reactor` | `7 7-17 * * 1-5` | in-process (webhook safety net) | `scheduled/` |
| `stale_task_check` | `17 * * * *` | in-process | `scheduled/` |

#### 2026-07 amendment — detection family as event-driven assembly lines

The detection family (`gap_detection`, `spec_drift`, `spec_coverage_validate`,
`spec_coverage_backfill`) no longer runs as K8s CronJobs. Each job is an
assembly-line definition with a deterministic `detect` node
(`libs/assembly-lines/src/assembly-lines/*.yaml`); an in-process cron emitter
inserts `cron.<job>.tick` at the same cadence, and the tick handler
(`apps/floor/src/jobs/detect/fan-out.ts`) starts one per-repo assembly line via
`assemblyLines().start()`. Runs are repo-less (no clone; the branch name is a
lease key) and each writes a `pipeline.job_runs` row named `<job>:<repo>`.
Rationale and controls mapping: ADR-019 amendment.

Manual trigger (replaces `kubectl create job` for these four):

```sql
-- full fan-out
INSERT INTO pipeline.events (event_name, source, params)
VALUES ('cron.spec_drift.tick', 'cron', '{}');
-- single repo
INSERT INTO pipeline.events (event_name, source, params)
VALUES ('cron.spec_drift.tick', 'cron', '{"repo":"re-cinq/lore"}');
```

## Architecture

```
┌─ lore-agent Deployment (replicas: 1, always-on) ──────────────────┐
│  node dist/index.js                                               │
│   • HTTP: /healthz, /api/trigger/{review-reactor,auto-merge}      │
│   • node-cron scheduler → jobs/scheduled/* (6 hot-path jobs)      │
│   • warm state: DB pool, Octokit, prompt-cache tracker            │
└───────────────────────────────────────────────────────────────────┘

┌─ Kubernetes CronJobs (one pod per run, isolated) ─────────────────┐
│  CronJob spec-test-linker  →  node dist/job-runner.js spec_test_linker │
│  CronJob spec-drift        →  node dist/job-runner.js spec_drift       │
│  … 10 total, schedules from the table above                       │
│   • same agent image, same env/secrets/SA (shared _env.tpl)       │
│   • concurrencyPolicy: Forbid, startingDeadlineSeconds, history   │
│   • job-runner.js: initPool() → dispatch[jobName]() → exit 0/1    │
└───────────────────────────────────────────────────────────────────┘
                manual run: kubectl create job --from=cronjob/<name>
```

## Functional Requirements

- **FR1 — Generic runner.** `agent/src/job-runner.ts` compiles to
  `dist/job-runner.js`, takes a job name argv, calls `initPool()`, dispatches to
  the matching batch-job function, logs its summary, and exits `0` on success or
  non-zero on error. Unknown job name → non-zero with a clear message.
- **FR1a — Run tracking parity.** The runner records each run in
  `pipeline.job_runs` exactly as the in-process scheduler's `runJob` does: insert
  a `running` row on start, update to `completed` with `result_summary` (the
  job's summary string) on success, or `failed` with `error` on exception. This
  keeps CronJob runs visible in the web-ui `/analytics` view and preserves
  history/observability parity with in-process jobs — without it, migrated jobs
  silently disappear from run tracking. The runner's exit code follows the
  outcome. (The k8s CronJob's `startingDeadlineSeconds` replaces the scheduler's
  app-level `checkMissedRuns` catch-up for these jobs.)
- **FR1b — Keep the run output.** `result_summary` is a one-line string; the
  full run output must be retained, not left to ephemeral pod stdout. The runner
  captures its stdout/stderr, redacts it, and persists it via the existing GCS
  log-storage path (`agent/src/lib/log-storage.ts` — same bucket, redaction, and
  CMEK encryption as task pod logs), under a job-run key
  (`__job_runs__/<job_name>/<run_id>/output.log`). `pipeline.job_runs` gains a
  `log_path` reference, and the output is retrievable in the UI / via MCP exactly
  like task logs (`lore_get_task_logs` → a `lore_get_job_logs` sibling). This applies to
  the CronJob path, where each pod's entire stdout is one job's output;
  per-job-isolated capture for the shared in-process scheduler is noted as a
  follow-up (see Limitations).
- **FR2 — One CronJob per batch job.** Each of the 10 batch jobs has a K8s
  CronJob with the schedule from the classification table, `concurrencyPolicy:
  Forbid`, a `startingDeadlineSeconds`, and bounded job history.
- **FR2a — Bounded resources + timeout (required).** Every CronJob pod sets
  resource `requests` **and** `limits` (CPU + memory) and an
  `activeDeadlineSeconds` wall-clock cap so a hung or runaway LLM-heavy run is
  killed rather than consuming the node indefinitely. A default block lives in
  `values.yaml`, **per-job overridable** (the LLM/embedding-heavy jobs —
  `context_reindex`, `eval_runner`, `autoresearch` — get higher memory/longer
  deadlines than the lightweight cleanups like `memory_ttl`). No CronJob ships
  without explicit `limits` — the migration must not leave an unbounded pod on
  the cluster. `backoffLimit` caps retries.
- **FR3 — No env drift.** CronJob pods reuse the agent image and the *same*
  environment, secrets, and `serviceAccountName` as the Deployment, sourced from
  a shared Helm template (`_env.tpl`).
- **FR4 — De-register migrated jobs.** The 10 migrated jobs are removed from the
  in-process scheduler (`registerJob` lines deleted from `index.ts`) so they run
  only as CronJobs.
- **FR5 — In-process jobs unchanged.** The 6 remaining jobs keep their existing
  in-process registration and behavior.
- **FR6 — Structural reorg.** Batch jobs live in `agent/src/jobs/cron/`,
  in-process jobs in `agent/src/jobs/scheduled/`; each folder has a `README.md`
  stating its runtime and container. All importers updated; agent typechecks and
  unit tests pass.
- **FR7 — On-demand run.** Any batch job can be run ad hoc with
  `kubectl create job --from=cronjob/<name>`, retiring the pod-exec workaround.
- **FR8 — Atomic cutover.** Adding a job's CronJob and removing its `registerJob`
  line ship in the same release, so no job ever runs both in-process and as a
  CronJob, nor neither.

## Acceptance Criteria

1. `node dist/job-runner.js <jobName>` runs each of the 10 batch jobs, initializes
   the DB pool, logs the job summary, and exits 0 on success / non-zero on error;
   an unknown name exits non-zero. ([validated by `job-runner.test.ts:42`](apps/floor/src/delivery/job-runner.test.ts#L42), [`job-runner.test.ts:47`](apps/floor/src/delivery/job-runner.test.ts#L47))
1a. Each runner invocation writes a `pipeline.job_runs` row — `running` on start,
   then `completed` (with `result_summary`) or `failed` (with `error`) — so a
   CronJob run appears in the web-ui `/analytics` view identically to an
   in-process run. ([validated by `job-run.test.ts:16`](apps/floor/src/adapters/job-run.test.ts#L16), [`job-run.test.ts:32`](apps/floor/src/adapters/job-run.test.ts#L32), [`job-run.test.ts:63`](apps/floor/src/adapters/job-run.test.ts#L63))
1b. A completed or failed CronJob run's full output is retained in GCS (redacted,
   CMEK-encrypted) and retrievable via the UI / MCP, referenced by
   `pipeline.job_runs.log_path` — not lost to ephemeral pod stdout. ([validated by `log-storage.test.ts:42`](apps/floor/src/main-loop/scheduling/log-storage.test.ts#L42), [`job-run.test.ts:31`](apps/floor/src/main-loop/scheduling/job-run.test.ts#L31))
2. Ten CronJobs exist, one per batch job, with schedules exactly matching the
   prior in-process schedules.
3. CronJob pods carry the same env vars, secret refs, and service account as the
   Deployment, rendered from the shared Helm env template (no duplicated literals).
4. The 10 `registerJob` lines for migrated jobs are removed from `index.ts`; the
   6 in-process registrations remain.
5. CronJobs set `concurrencyPolicy: Forbid` and a `startingDeadlineSeconds`, so
   runs never overlap and a tick missed during a brief outage still fires.
5a. Every rendered CronJob has non-empty resource `requests` and `limits` plus an
   `activeDeadlineSeconds`; none ship unbounded. Heavy jobs render with higher
   memory/deadline than the lightweight cleanups, via per-job overrides.
6. `agent/src/jobs/cron/` and `agent/src/jobs/scheduled/` exist, each with a
   `README.md` naming its runtime/container; `agent` typecheck and `vitest run`
   pass after the move.
7. `kubectl create job --from=cronjob/<name>` runs a batch job on demand.
8. No job is scheduled both in-process and as a CronJob in any release. ([validated by `job-runner.test.ts:44`](apps/floor/src/delivery/job-runner.test.ts#L44))

## File Changes

| File | Change |
|------|--------|
| `agent/src/job-runner.ts` | New: CLI entrypoint + dispatch table for the 10 batch jobs; records `pipeline.job_runs` + persists output to GCS |
| `agent/src/lib/job-run.ts` | New: shared run bookkeeping (`pipeline.job_runs` insert/update) extracted from `scheduler.ts`, reused by the runner |
| `agent/src/lib/log-storage.ts` | Add `writeJobRunLogs`/`readJobRunLogs` (job-run-keyed) alongside the task-log helpers |
| `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_job_runs_log_path.sql` | New: `ALTER TABLE pipeline.job_runs ADD COLUMN log_path TEXT` (idempotent) |
| `mcp-server` + `web-ui` | `lore_get_job_logs` MCP tool + a job-run log view (mirrors `lore_get_task_logs` / `TaskLogs.tsx`); `/analytics` job_runs rows link to the output |
| `agent/src/jobs/cron/*.ts` | Moved: the 10 batch jobs (+ `spec-drift-rules.ts`, test files); import depth fixed |
| `agent/src/jobs/cron/README.md` | New: "each file runs as its own K8s CronJob pod (separate container)" |
| `agent/src/jobs/scheduled/*.ts` | Moved: the 6 in-process jobs; import depth fixed |
| `agent/src/jobs/scheduled/README.md` | New: "runs in-process inside the lore-agent container via node-cron" |
| `agent/src/index.ts` | Remove 10 `registerJob` + imports; repoint the 6 in-process imports to `scheduled/` |
| `agent/src/health.ts` | Repoint `review-reactor` import to `scheduled/` |
| `agent/Dockerfile` | No change — `dist/job-runner.js` is baked with the rest of `dist/` |
| `terraform/modules/gke-mcp/agent-helm/templates/_env.tpl` | New: shared env block (define) |
| `terraform/modules/gke-mcp/agent-helm/templates/deployment.yaml` | Use the shared `_env.tpl` |
| `terraform/modules/gke-mcp/agent-helm/templates/cronjob.yaml` | New: templated CronJob per `cronJobs` values entry |
| `terraform/modules/gke-mcp/agent-helm/values.yaml` | New `cronJobs` list (name, schedule, job) + CronJob defaults |

## Limitations & Open Questions

1. **HA is not unlocked by this change.** The 6 remaining in-process crons still
   double-fire on a second replica, so `lore-agent` stays `replicas: 1`.
   Leader election (or moving the watchers to a leader-elected controller) is a
   separate, larger effort — out of scope here.
2. **Borderline jobs stay in-process.** `review_reactor` (the webhook safety net)
   and `stale_task_check` are left in-process for now; revisit if they grow heavy.
3. **Cold-start cache loss.** CronJob pods don't share the agent's in-memory
   prompt-cache break tracker, so the first LLM call each run is a cache write.
   Acceptable at weekly/daily cadence; noted for cost accounting.
4. **In-process output capture.** Full-output retention (FR1b) is clean for
   CronJobs (one job per pod = one stdout). Capturing per-job-isolated output
   inside the shared in-process scheduler — where multiple jobs and the webhook
   handlers interleave on one stdout — needs per-handler stream interception and
   is racy; left as a follow-up. In-process runs keep `result_summary`/`error`
   in `job_runs` plus the agent pod log in Cloud Logging.
5. **Schedule source of truth.** Schedules now live in `values.yaml` rather than
   `index.ts`. The classification table here is the reference; keep them in sync.
