# Feature Specification: Scheduled Job Runtime Split

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Scheduled Job Runtime Split (in-process ↔ K8s CronJob) |
| Status   | In Progress                                     |
| Created  | 2026-06-02                                    |
| Owner    | Platform Engineering                          |
| ADR      | [ADR-019](../../adrs/ADR-019-scheduled-job-runtime-split.md) |
| Supersedes | Scheduling portion of [5-lore-agent](../5-lore-agent/spec.md) (Problem #5, FR-6, SC#2) |

This runtime split runs Lore's periodic work under two profiles — sub-minute, hot-path, webhook-coupled jobs stay in the always-on agent's in-process scheduler while heavy, infrequent batch jobs move to isolated Kubernetes CronJobs — so each batch job gets its own resource limits, retries, timeouts, missed-run catch-up, and run history.

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

- **FR8 — A courier CronJob starts a line; it does not run the job.** A scheduled
  job that is not coordination work does not need to live in a coordinator. The
  schedule stays in Kubernetes, the work moves into an assembly line, and the pod
  between them carries one message and holds no business logic. This removes the
  reason four batch jobs live in `apps/floor`: they were there because the Floor's
  image was what the alarm launched, not because the Floor coordinates them.
- **FR8.1 — `POST /api/assembly-runs` starts one run of a blueprint.** The body is
  `{ definition, repo, branch?, args? }`; the response is `201` with the minted
  run id. Before this, `assemblyRuns.start()` was reachable only in-process from
  the Floor, so anything wanting to start a line had to be the Floor. The write is
  `start()`'s existing atomic CTE — the `pipeline.assembly_runs` row and its
  `assembly_run.start` event land together — and the Floor's event loop claims the
  event and walks the line as it does for every other run. ([validated by `start-run.test.ts:40`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L40), [`start-run.test.ts:52`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L52), [`start-run.test.ts:72`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L72))
- **FR8.2 — The start endpoint refuses a body it cannot act on.** A missing
  `definition` or a `repo` that is not `owner/name` is rejected `400` and starts
  nothing; a run row minted from a malformed body would be walked by the Floor and
  fail somewhere less legible than the call that made it. ([validated by `start-run.test.ts:85`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L85), [`start-run.test.ts:95`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L95))
- **FR8.3 — The endpoint is authenticated.** It is registered on the built server
  under the `task` bearer scope; an unauthenticated post is rejected `401`. Starting
  arbitrary assembly lines is a privileged capability — the courier holds a token
  like any other client. ([validated by `start-run.test.ts:109`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L109))

- **FR9 — A scheduled job with no steps runs in lore-api, not in a line.** The
  assembly-line node types are a closed set (`agent`, `validate`, `gate`,
  `retrospective`, `github_action`, `detect`, `comment-triage`, `ingest`,
  `issues`, human stations) and none of them is "do a data operation". A
  one-node line for a single `DELETE` would put a station pod and a Floor walk
  between the alarm and one statement, so the courier posts
  `POST /api/maintenance/<job>` instead and lore-api runs it next to the
  database it writes. Work with steps still starts a line — only the courier's
  path differs.
- **FR9.1 — The endpoint runs the job named in the path and returns its
  summary.** `200` with `{ job, summary }`, the summary being the one-line
  string that was `pipeline.job_runs.result_summary`. An unknown job name is
  `404` — a courier typo must not read as success. ([validated by `maintenance.test.ts:24`](apps/lore-api/src/api/routes/maintenance/maintenance.test.ts#L24), [`maintenance.test.ts:36`](apps/lore-api/src/api/routes/maintenance/maintenance.test.ts#L36), [`maintenance.test.ts:57`](apps/lore-api/src/api/routes/maintenance/maintenance.test.ts#L57))
- **FR9.2 — A failing job answers with a status and nothing else.** The
  courier's only channel is an HTTP status, and a job's error can carry
  connection strings and hostnames; the detail is logged where operators look
  and never returned. ([validated by `maintenance.test.ts:43`](apps/lore-api/src/api/routes/maintenance/maintenance.test.ts#L43))
- **FR9.4 — Importance decay follows the same route.** Scoring memories against
  the half-life model and evicting past the per-agent cap is scoring plus
  database writes, so it runs in lore-api. Behaviour is carried over unchanged:
  only the count above the cap is evicted, the highest-scoring memory survives,
  an agent under the cap loses nothing, one `importance-decay` audit entry is
  written per agent evicted from, and the summary names memories, facts and
  stale transitions, reporting zero for each path with nothing to do. Ageing
  facts to `stale` stays non-fatal — failing the run over it would leave a
  completed eviction unreported. Memories are scored against one clock read
  once for the whole batch, so two agents cannot rank the same memory
  differently within a run. ([validated by `importance-decay.test.ts:32`](apps/lore-api/src/features/maintenance/importance-decay.test.ts#L32), [`importance-decay.test.ts:44`](apps/lore-api/src/features/maintenance/importance-decay.test.ts#L44), [`importance-decay.test.ts:54`](apps/lore-api/src/features/maintenance/importance-decay.test.ts#L54), [`importance-decay.test.ts:67`](apps/lore-api/src/features/maintenance/importance-decay.test.ts#L67), [`importance-decay.test.ts:79`](apps/lore-api/src/features/maintenance/importance-decay.test.ts#L79), [`importance-decay.test.ts:107`](apps/lore-api/src/features/maintenance/importance-decay.test.ts#L107))
- **FR9.3 — `memory_ttl` is the first job to move.** Its 14 lines around one
  `expireMemories()` call, and the CronJob pod built from the Floor's image that
  ran them, are deleted; the schedule is unchanged. The registry in
  [`maintenance.ts`](apps/lore-api/src/api/routes/maintenance/maintenance.ts) is where the remaining data jobs land as they follow.

## Acceptance Criteria

1. `node dist/job-runner.js <jobName>` runs each of the 10 batch jobs, initializes
   the DB pool, logs the job summary, and exits 0 on success / non-zero on error;
   an unknown name exits non-zero. `resolveJob` returns the dispatch handler for a known name and
   null for an unknown or empty name; `runJobByName` invokes the resolved handler and exits 0.
   ([`job-runner.test.ts:52`](apps/floor/src/delivery/job-runner.test.ts#L52), [`job-runner.test.ts:56`](apps/floor/src/delivery/job-runner.test.ts#L56), [`job-runner.test.ts:66`](apps/floor/src/delivery/job-runner.test.ts#L66), [validated by `resolves %s to a handler function`](apps/floor/src/delivery/job-runner.test.ts#L40))

1a. Each runner invocation writes a `pipeline.job_runs` row — `running` on start,
   then `completed` (with `result_summary`) or `failed` (with `error`) — so a
   CronJob run appears in the web-ui `/analytics` view identically to an
   in-process run. `startJobRun` opens a `running` row and returns the run id, `completeJobRun`
   stamps `completed` with the `result_summary`, and `failJobRun` stamps `failed` with the error.
   ([`job-run.test.ts:6`](apps/floor/src/main-loop/scheduling/job-run.test.ts#L6), [`job-run.test.ts:18`](apps/floor/src/main-loop/scheduling/job-run.test.ts#L18), [`job-run.test.ts:51`](apps/floor/src/main-loop/scheduling/job-run.test.ts#L51))

1b. A completed or failed CronJob run's full output is retained in GCS (redacted,
   CMEK-encrypted) and retrievable via the UI / MCP, referenced by
   `pipeline.job_runs.log_path` — not lost to ephemeral pod stdout. `jobRunLogKey` builds the
   `__job_runs__/<job>/<runId>/output.log` key, and both `completeJobRun` and `failJobRun` persist
   the `log_path` when provided. ([validated by `log-storage.test.ts:42`](apps/floor/src/main-loop/scheduling/log-storage.test.ts#L42), [`job-run.test.ts:31`](apps/floor/src/main-loop/scheduling/job-run.test.ts#L31), [`log-storage.test.ts:10`](apps/floor/src/main-loop/scheduling/log-storage.test.ts#L10), [`job-run.test.ts:64`](apps/floor/src/main-loop/scheduling/job-run.test.ts#L64))

1c. The in-process scheduler clears a job's in-flight marker on every failure
   path: a rejected `startJobRun` (`pipeline.job_runs` insert failure) is logged
   without a phantom `failJobRun` call and the job runs again on the next tick
   instead of staying wedged for the process lifetime; a handler failure passes
   its message to `failJobRun` and likewise leaves the job re-eligible; a
   successful run passes the handler result to `completeJobRun`; and
   `getJobStatus` reports `idle` plus the in-memory last-attempt timestamp
   (`null` before the first attempt in this process).
   ([validated by `scheduler.test.ts:42`](apps/floor/src/main-loop/scheduling/scheduler.test.ts#L42), [`scheduler.test.ts:66`](apps/floor/src/main-loop/scheduling/scheduler.test.ts#L66), [`scheduler.test.ts:79`](apps/floor/src/main-loop/scheduling/scheduler.test.ts#L79), [`scheduler.test.ts:95`](apps/floor/src/main-loop/scheduling/scheduler.test.ts#L95), [`scheduler.test.ts:111`](apps/floor/src/main-loop/scheduling/scheduler.test.ts#L111), [`scheduler.test.ts:126`](apps/floor/src/main-loop/scheduling/scheduler.test.ts#L126))

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
8. No job is scheduled both in-process and as a CronJob in any release. ([validated by `job-runner.test.ts:46`](apps/floor/src/delivery/job-runner.test.ts#L46))

9. Each migrated batch job is an independently-runnable unit the runner dispatches and whose one-line
   result the run row records: `memory_ttl` soft-deletes expired memories and reports the count,
   `anthropic_cost_sync` returns a skip summary when `ANTHROPIC_ADMIN_KEY` is unset (and otherwise
   parses the Admin cost/usage report — cents-string amount → dollars, 1h + 5m ephemeral
   cache-creation buckets summed, cost joined to tokens per date+model), and `context_reindex`
   selects only the doc seed roots (`CLAUDE.md`/`AGENTS.md`/`adrs/`/`specs/<feature>`/`.specify`),
   excluding source code, root docs, and binary/unsupported files. ([validated by `ttl-cleanup.test.ts:25`](apps/floor/src/jobs/memory/ttl-cleanup/ttl-cleanup.test.ts#L25), [`ttl-cleanup.test.ts:34`](apps/floor/src/jobs/memory/ttl-cleanup/ttl-cleanup.test.ts#L34), [`anthropic-cost-sync.test.ts:9`](apps/floor/src/jobs/cost/anthropic-cost-sync/anthropic-cost-sync.test.ts#L9), [`anthropic-cost.test.ts:9`](apps/floor/src/jobs/cost/anthropic-cost.test.ts#L9), [`anthropic-cost.test.ts:37`](apps/floor/src/jobs/cost/anthropic-cost.test.ts#L37), [`anthropic-cost.test.ts:75`](apps/floor/src/jobs/cost/anthropic-cost.test.ts#L75), [`reindex-seed.test.ts:5`](apps/floor/src/jobs/context-jobs/reindex/reindex-seed.test.ts#L5), [`reindex-seed.test.ts:30`](apps/floor/src/jobs/context-jobs/reindex/reindex-seed.test.ts#L30), [`reindex-seed.test.ts:36`](apps/floor/src/jobs/context-jobs/reindex/reindex-seed.test.ts#L36))

10. The detection-family cron tick fans out one per-repo assembly line (2026-07 amendment):
   `detectBranchName` keys each run `detect/<definition>/<repo>` (the old lease key, now the
   overlap-guard key), the handler pre-creates a `pipeline.job_runs` row (`<job_ref>:<repo>`) and
   starts one line per target repo with that branch + `args.job_run_id`, restricts to `params.repo`
   without enumerating when a single repo is given, starts nothing when there are no target repos, and
   fails the just-created job_run (before rethrowing) if `assemblyLines.start` throws. The spec-scoped
   target lists (`activeSpecRepos`/`specRepos`) enumerate repos across every provisioned chunk schema
   (team schemas ∪ org_shared), not a fixed org_shared: the schema list intersects
   `information_schema` with `lore.repos.team` behind a schema-name injection gate, one grouped
   UNION ALL query spans all schemas, and the active variant gates each repo on a code chunk
   ingested inside the 7-day activity window. ([validated by `fan-out.test.ts:33`](apps/floor/src/jobs/detect/fan-out.test.ts#L33), [`fan-out.test.ts:41`](apps/floor/src/jobs/detect/fan-out.test.ts#L41), [`fan-out.test.ts:88`](apps/floor/src/jobs/detect/fan-out.test.ts#L88), [`fan-out.test.ts:111`](apps/floor/src/jobs/detect/fan-out.test.ts#L111), [`fan-out.test.ts:127`](apps/floor/src/jobs/detect/fan-out.test.ts#L127), [`fan-out.test.ts:162`](apps/floor/src/jobs/detect/fan-out.test.ts#L162), [`fan-out.test.ts:173`](apps/floor/src/jobs/detect/fan-out.test.ts#L173), [`fan-out.test.ts:187`](apps/floor/src/jobs/detect/fan-out.test.ts#L187), [`fan-out.test.ts:195`](apps/floor/src/jobs/detect/fan-out.test.ts#L195), [`fan-out.test.ts:205`](apps/floor/src/jobs/detect/fan-out.test.ts#L205), [`fan-out.test.ts:215`](apps/floor/src/jobs/detect/fan-out.test.ts#L215), [`fan-out.test.ts:229`](apps/floor/src/jobs/detect/fan-out.test.ts#L229))

11. `context_reindex` ends every per-repo pass with a verification sweep (ADR-019 amendment
   2026-07, issue #967 — `ingested_at` on reindex-owned rows now means "last verified against the
   repo tree"): reindex-owned chunks (`ingested_by = 'reindex-job'`) whose files still exist in the repo
   tree get `ingested_at` re-stamped so the stale count clears, chunks of files missing from the
   tree are pruned, api-ingested chunks are never touched or pruned, an empty tree skips the
   sweep entirely, and re-stamping skips files verified within the last 30 days to keep
   steady-state nights from rewriting every row. ([validated by `verify.test.ts:55`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L55), [`verify.test.ts:69`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L69), [`verify.test.ts:87`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L87), [`verify.test.ts:99`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L99), [`verify.test.ts:109`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L109))
   - Each team-resolved per-repo pass also begins with legacy relocation (issue #979, FR-20.21
     in `specs/1-lore-platform/spec.md`): before counting the repo's chunks — so a newly
     team-resolved repo adopts its history instead of reading as empty and re-seeding — any rows
     the repo still holds in `org_shared.chunks` move into its resolved schema, non-fatally, and
     the org_shared-resolved pass skips relocation entirely ([validated by `chunks.test.ts:672`](libs/shared/src/project/chunks/chunks.test.ts#L672), [`chunks.test.ts:735`](libs/shared/src/project/chunks/chunks.test.ts#L735), [`chunks.test.ts:746`](libs/shared/src/project/chunks/chunks.test.ts#L746))
   - Pruning leaves an audit trail: the verification pass returns the distinct pruned file
     paths (a hard DELETE has no other record of what vanished), and the reindex job writes a
     `reindex_prune` row to `pipeline.audit_log` per repo with the row count and the path list
     capped at 500 entries plus a truncation flag ([validated by `verify.test.ts:69`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L69), [`verify.test.ts:99`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L99))
   - Each pass also runs a chunker-upgrade heal sweep (issue #995): `staleChunkerFiles` returns
     the repo's distinct code file paths whose chunks carry a `metadata.chunker_version` older
     than the current `CHUNKER_VERSION` (absent counts as 0), sorted and capped, and the sweep
     re-ingests them — skipping files the changed-file loop already processed this run, logging
     past per-file ingest failures, and deleting the chunks of a file the ingest declines
     (classifyFile no longer supports its path) so the capped query converges instead of
     re-selecting the same wedged files nightly — so chunking fixes reach files that never
     change, with the per-run cap spreading the one-time re-embed across nights
     ([validated by `chunks.test.ts:781`](libs/shared/src/project/chunks/chunks.test.ts#L781), [`chunks.test.ts:820`](libs/shared/src/project/chunks/chunks.test.ts#L820), [`reindex-heal.test.ts:27`](apps/floor/src/jobs/context-jobs/reindex/reindex-heal.test.ts#L27), [`reindex-heal.test.ts:53`](apps/floor/src/jobs/context-jobs/reindex/reindex-heal.test.ts#L53), [`reindex-heal.test.ts:75`](apps/floor/src/jobs/context-jobs/reindex/reindex-heal.test.ts#L75), [`reindex-heal.test.ts:97`](apps/floor/src/jobs/context-jobs/reindex/reindex-heal.test.ts#L97))
   - Each pass ends with a never-ingested backfill sweep (issue #999): the repo tree is diffed
     against `chunkedFilePaths` — the distinct file paths holding ANY chunk regardless of owner or
     content type, so api/ui-ingested files are never re-ingested and re-owned — and the
     classifyFile-supported files with no chunks are ingested, sorted then capped at 200 per repo
     per run so an oversized gap (a docs-only full seed plus a changed-file path that only sees
     post-onboarding commits leaves pre-existing code files permanently unindexed) drains
     deterministically across nights, skipping files the changed-file loop already processed this
     run, logging past per-file ingest failures, and counting only files the ingest accepted
     ([validated by `chunks.test.ts:846`](libs/shared/src/project/chunks/chunks.test.ts#L846), [`chunks.test.ts:868`](libs/shared/src/project/chunks/chunks.test.ts#L868), [`reindex-backfill.test.ts:24`](apps/floor/src/jobs/context-jobs/reindex/reindex-backfill.test.ts#L24), [`reindex-backfill.test.ts:57`](apps/floor/src/jobs/context-jobs/reindex/reindex-backfill.test.ts#L57), [`reindex-backfill.test.ts:78`](apps/floor/src/jobs/context-jobs/reindex/reindex-backfill.test.ts#L78), [`reindex-backfill.test.ts:103`](apps/floor/src/jobs/context-jobs/reindex/reindex-backfill.test.ts#L103), [`reindex-backfill.test.ts:121`](apps/floor/src/jobs/context-jobs/reindex/reindex-backfill.test.ts#L121))

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
