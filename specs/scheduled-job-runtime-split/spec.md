# Feature Specification: Scheduled Job Runtime Split

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Scheduled Job Runtime Split (in-process ↔ K8s CronJob) |
| Status   | In Progress                                     |
| Created  | 2026-06-02                                    |
| Owner    | Platform Engineering                          |
| ADR      | [ADR-019](../../adrs/ADR-019-scheduled-job-runtime-split.md) |
| Supersedes | Scheduling portion of `5-lore-agent` (Problem #5, FR-6, SC#2) |

Lore's periodic work is scheduled in two ways. The stations service emits a `cron.<job>.tick` event for every job that reads many rows or starts runs, and answers each tick with a sweep. A courier CronJob posts `POST /api/stations/<name>` for every job that is one data operation. No scheduled job has an image of its own, and nothing is scheduled inside lore-api.

## Problem Statement

A scheduled job needs three things: something that fires it on time, a place
where its code runs, and a record that it ran. The first design gave every job
all three in one process, and the second gave every heavy job a pod of its
own. Both tied the place the code lives to the way the job is fired.

Jobs differ by shape, not by cadence:

- A job that needs an agent, a workspace or a pull request is a run of a line
  on the external floor. Only its start is scheduled.
- A job that is a query and a few writes runs beside the database, in the
  stations service. It needs no pod and no line.
- A job that is one data operation, started at a fixed hour, needs a timer and
  nothing else.

## Background

This spec was written on 2026-06-02 for Lore's own Floor (`apps/floor`). The
Floor ran sub-minute jobs in an in-process `node-cron` scheduler and ran heavy
batch jobs as Kubernetes CronJob pods built from its own image, each started
through a generic `job-runner` CLI. The runner recorded every run in
`pipeline.job_runs` and stored the pod's output in GCS.

Three amendments changed that design before it was removed:

- 2026-07: the detection family (`gap_detection`, `spec_drift`,
  `spec_coverage_validate`, `spec_coverage_backfill`) became assembly lines
  started by `cron.<job>.tick` events.
- 2026-08: the batch jobs were re-homed by shape. The single-operation jobs
  became stations posted to by a courier CronJob.
- 2026-09-08: `context_reindex` was retired. Ingestion is merge-time CI only.

Lore's own Floor was deleted on 2026-10-02 (`specs/external-floor` FR16,
ADR-049). The `job-runner` CLI, the per-job CronJob pods, the `floor-helm`
chart and the detection family went with it. The jobs that are gone:

| Job | What happened |
|-----|---------------|
| `eval_runner` | deleted 2026-10-02. It skipped every night because `promptfoo` was not in the image. Context evals are run from a developer machine (`scripts/context-evals/`), never on a schedule |
| `context_core_builder` | deleted 2026-10-02. It promoted nothing. Migration 0101 dropped its tables |
| `autoresearch` | deleted with the eval jobs it depended on |
| `context_reindex` | retired 2026-09-08, no replacement |
| `gap_detection` | deleted 2026-10-02 (`specs/external-floor` FR16.6). No replacement yet (#2333) |
| `spec_drift`, `spec_coverage_validate`, `spec_coverage_backfill` | deleted 2026-10-02. The `spec-upkeep` line on the external floor fixes drift and adds links |
| `approval_check` | deleted 2026-10-02 (`specs/external-floor` FR16.12) |
| `stale_task_check`, `lease_reaper`, `assembly_line_reaper`, `agent_watcher_reconcile`, `loretask_watcher`, `review_reactor` | deleted with the Floor or before it. They served the Floor's own worker and walk |
| `spec_task_executor` | deleted 2026-10-07 (`specs/external-floor` FR15.0). A plan's tasks are tickets of the implementation loop |

ADR-019's amendment of 2026-11-13 holds the full list with the reason for each
job.

## Solution

One scheduler is left, and it lives in the stations service
(`apps/stations/src/index.ts`, `startCronTicks`). It does no work itself. It
inserts tick events into `pipeline.events`, and the stations service's own
drain answers them.

- **Tick jobs.** `CRON_EMITTERS` (`libs/shared/src/work/scheduler/cron-emitters.ts`)
  lists every tick with its schedule. A sweep under `apps/stations/src/work/`
  declares the tick in its `manifest.ts` and runs when the tick is delivered.
  A sweep either does the work itself or starts runs on the external floor.
- **Courier jobs.** `courierJobs` in
  `deploy/chart/charts/stations-helm/values.yaml` lists each single-operation
  job with its schedule. Kubernetes fires a `curl` pod that posts
  `POST /api/stations/<name>` and exits. The sweep runs in the stations
  service.

### Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Split axis | **Shape**: work with an agent, a workspace or a pull request is a line on the external floor; a query and a few writes is a stations sweep | The place the code lives no longer follows from how the job is fired (ADR-019, 2026-08 and 2026-11-13 amendments) |
| Tick or courier | A sweep that other code also starts by event, or that runs more often than hourly, hangs off a tick. A single data operation at a fixed hour is a courier job | A tick is an event anything can emit. A courier job keeps its schedule, history and missed-run catch-up in Kubernetes |
| Tick emitter | The stations service, one replica | It answers every tick, so it emits them too (`specs/external-floor` FR16) |
| Tick dedupe | One event per job per minute slot, by `dedupe_key` | Two processes that both emit during a rollout produce one event |
| Courier image | `curlimages/curl`, pinned by digest | The pod holds the org ingest token, and a tag can be repointed |
| Courier policy | `concurrencyPolicy: Forbid`, `startingDeadlineSeconds`, bounded history, `restartPolicy: Never`, `backoffLimit: 2`, `activeDeadlineSeconds: 120`, fixed `requests` and `limits` | A wedged pod cannot start a second run, and no pod runs unbounded |
| Run of the work | In the stations service, beside the database | A single statement needs no pod of its own |

### Job classification

Tick jobs. The stations service emits the tick and the named sweep answers it.

| Tick | Schedule (UTC) | Sweep | What the sweep does |
|------|----------------|-------|---------------------|
| `merge_check` | `*/1 * * * *` | `merge-check` | reads merged and closed pull requests and settles their tasks |
| `pr_ready_check` | `*/2 * * * *` | `pr-ready-check` | answers the parked CI and merge waits of floor runs |
| `issue_triage` | `*/2 * * * *` | `issue-triage-tick` | starts `issue-triage` runs on the external floor |
| `implementation_loop` | `*/5 * * * *` | `loop-tick` | starts `implementation-loop` runs on the external floor |
| `auto_merge` | `*/5 * * * *` | `auto-merge-tick` | starts `auto-merge` runs on the external floor |
| `loop_reap` | `*/15 * * * *` | `loop-reap` | fails a loop task stuck running with no floor run |
| `daily_digest` | `*/15 * * * *` | `digest-tick` | starts a `daily-digest` run per Slack channel that is due |
| `events_prune` | `0 * * * *` | `bus-prune` | prunes handled deliveries and old agent telemetry |
| `telemetry_prune` | `43 3 * * *` | `telemetry-prune` | 14-day reap of `agent_run_events` and `pod_log_chunks` |
| `pr_blocked_reasons_prune` | `53 3 * * *` | `pr-blocked-reasons-prune` | 30-day purge of closed rows in `pipeline.pr_blocked_reasons` |
| `utopia_backfill` | `30 2 * * 0` | `utopia-backfill-tick` | posts the Utopia backfill for every onboarded repo |
| `webhook_ensure` | `0 3 * * 1` | `webhook-ensure-tick` | points every onboarded repo's webhook at Lore again |
| `changelog` | `0 6 * * 1` | `changelog-tick` | starts a `weekly-changelog` run per onboarded repo |
| `spec_upkeep` | `0 10 * * 1` | `spec-upkeep-tick` | starts a `spec-upkeep` run per onboarded repo |

Courier jobs. Kubernetes fires the post and the named sweep does the work.

| Job | Schedule (UTC) | Sweep | What the sweep does |
|-----|----------------|-------|---------------------|
| `memory_ttl` | `0 * * * *` | `memory-ttl` | expires memories whose TTL has passed |
| `importance_decay` | `0 5 * * *` | `importance-decay` | scores and evicts memories past the per-agent cap, ages unretrieved facts |
| `consolidation` | `30 5 * * *` | `consolidation` | asks a model for patterns in the last 7 days of facts, per repo |
| `anthropic_cost_sync` | `0 7 * * *` | `anthropic-cost-sync` | imports the Anthropic daily cost report |
| `gcp_cost_sync` | `0 8 * * *` | `gcp-cost-sync` | imports the GCP daily billing report |

## Architecture

```
┌─ lore-stations Deployment (replicas: 1) ──────────────────────────┐
│  scheduler (every 30 s)                                           │
│   • for each CRON_EMITTERS entry that is due:                     │
│       job_runs row → insert cron.<job>.tick → close the row       │
│  drain                                                            │
│   • claims cron.<job>.tick → runs the sweep that declares it      │
│       sweep does the work, or starts runs on the external floor   │
│  HTTP                                                             │
│   • POST /api/stations/<name> → runs the sweep, answers a summary │
└───────────────────────────────────────────────────────────────────┘
                     ▲
┌─ Courier CronJobs (lore-stations-courier-<name>, curl) ───────────┐
│  one per courierJobs entry: POST /api/stations/<name>, then exit  │
└───────────────────────────────────────────────────────────────────┘
```

## Functional Requirements

- **FR1: The stations service emits every tick.** At boot `startCronTicks` (`apps/stations/src/index.ts`) registers each `CRON_EMITTERS` entry with the scheduler from `createCronScheduler`, and the registered job inserts one `cron.<name>.tick` event with source `cron`. ([validated by inserts cron.merge_check.tick keyed on its minute, so a tick two processes emit is one event @bbcded20](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L149))
- **FR1.1: A tick is one event per minute slot.** The event's `dedupe_key` is `cron:<name>:<minute>`, so a tick that two processes emit in the same minute is stored once. ([validated by inserts cron.merge_check.tick keyed on its minute, so a tick two processes emit is one event @bbcded20](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L149))
- **FR1.2: The scheduler decides what is due from `pipeline.job_runs`.** A job is due when it has no recorded run, or when its last run started before its latest cron slot. A job whose last run is after that slot is left alone, which is how two processes take turns during a rollout. ([validated by leaves a job alone whose last recorded run is after its latest cron slot, which is how two processes take turns @932d8d7f](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L132))
- **FR1.3: The scheduler catches up on start.** `start()` runs every job that is already due, then checks again every 30 seconds. A tick missed while the process was down is emitted once when it comes back.
- **FR1.4: No tick is emitted for a job that is gone.** `CRON_EMITTERS` names no tick for the detection family, for the jobs only the old Floor answered, or for `spec_task_executor`. ([validated by names no tick for gap_detection, spec_drift, spec_coverage_backfill or spec_coverage_validate, whose lines only the old Floor walked @2982c8a8](libs/shared/src/work/scheduler/cron-emitters.test.ts#L5), [validated by names no tick that only the old Floor answered: stale_task_check, assembly_line_reaper, agent_watcher_reconcile, lease_reaper, llm_credit_probe @25e74173](libs/shared/src/work/scheduler/cron-emitters.test.ts#L22), [validated by names no tick for spec_task_executor, the second dispatcher the backlog implementation loop replaced @c8cd2a68](libs/shared/src/work/scheduler/cron-emitters.test.ts#L35))
- **FR2: Every tick emit is a `pipeline.job_runs` row.** The scheduler inserts a `running` row named after the emitter, then closes it `completed` with the summary `emitted cron.<name>.tick`, or `failed` with the error. The row records that the tick was emitted, not that the sweep finished. ([validated by completes the run with the handler result on success @6c47b67f](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L61), [validated by inserts a running row and returns the new run id @0d689710](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L23))
- **FR2.1: A job_run is settled once.** `complete` and `fail` are guarded on `completed_at IS NULL`, so the first writer decides and a later writer changes nothing. ([validated by keeps the winner's completed verdict when a loser then fails it @24a33ecc](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L182), [`job-runs.test.ts@60279ead`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L196))
- **FR2.2: Tick emits show on `/analytics`.** The web UI's job-runs table lists each row with its duration and result summary, and shows the error in place of the result for a failed run. ([validated by renders job runs with seconds duration, result summary and a logs view link @80ad95c5](apps/web-ui/src/app/analytics/AnalyticsView.test.tsx#L265), [validated by renders a minutes duration and shows the error in place of the result when a job failed @7a203293](apps/web-ui/src/app/analytics/AnalyticsView.test.tsx#L280))
- **FR2.3: No scheduled run stores its output.** Nothing writes `pipeline.job_runs.log_path` any more: the runner that captured a pod's output is gone. A sweep's log lines are in the stations pod log, and the job-run page says that no `log_path` is recorded. ([validated by shows in-process message when no log_path is recorded and logs are null @3ebd798a](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L97))
- **FR2.4: The output of older runs stays readable.** `GET /api/job-run-logs` on lore-api reads `__job_runs__/<job_name>/<run_id>/output.log` from the log bucket and answers empty and incomplete when the file does not exist. The `lore_get_job_logs` MCP tool reads that route. ([validated by returns the file content when it exists @527a67cb](apps/lore-api/src/transport/routes/tasks/job-run-logs.test.ts#L51), [validated by returns empty and incomplete when the file does not exist @c85274d9](apps/lore-api/src/transport/routes/tasks/job-run-logs.test.ts#L44), [validated by returns the job output read from /api/job-run-logs for context_reindex run r1 @eabbc71b](apps/mcp-server/src/transport/tools/pipeline/get-job-logs.test.ts#L34))
- **FR3: A tick is answered by the one sweep that declares it.** A sweep's `manifest.ts` names its tick in an `event` trigger. The stations service subscribes to every event name a manifest declares and maps a handler for each. ([validated by claims every event name a station's manifest declares @fc76fb42](apps/stations/src/events/subscriptions.test.ts#L7), [validated by maps a handler for each name it subscribes to, so nothing dead-letters on arrival @3f9a76a1](apps/stations/src/events/subscriptions.test.ts#L31), [validated by claims the merge-check and pr-ready-check ticks, so no other service has to start those sweeps @887e88f4](apps/stations/src/events/subscriptions.test.ts#L107))
- **FR3.1: One event name belongs to one sweep.** Two sweeps never declare the same tick, so two do not race for it. ([validated by subscribes each event name to one station, so two do not race for it @f3be5513](apps/stations/src/work/registry.test.ts#L52))
- **FR3.2: Every sweep folder is registered.** A folder under `apps/stations/src/work/` that is missing from the registry fails the registry test. ([validated by registers every station folder, so adding one and forgetting the barrel fails here @52f4daf8](apps/stations/src/work/registry.test.ts#L15))
- **FR3.3: Every emitted tick has a sweep.** Each of the 14 `CRON_EMITTERS` entries is declared by one sweep's manifest, as the classification table lists.
- **FR4: Work with steps is a run on the external floor, started by a tick sweep.** The sweep reads which repositories are due and calls the floor. It runs no agent and opens no pull request itself. `spec-upkeep-tick` is the example: it starts one `spec-upkeep` run per repository, keyed on the day. ([validated by starts one spec-upkeep run per repository, on that day's branch and keyed on the day @624e4d79](libs/shared/src/work/spec-upkeep/floor-spec-upkeep.test.ts#L49), [validated by still names cron.spec_upkeep.tick, the weekly line that replaced the drift and backfill fan-outs @23c8116b](libs/shared/src/work/scheduler/cron-emitters.test.ts#L18))
- **FR4.1: A tick that names a repository runs for that repository only.** A `repo` in the tick's params restricts the spec-upkeep sweep to it. ([validated by starts only acme/gears when the tick names that repository @e6b8d934](libs/shared/src/work/spec-upkeep/floor-spec-upkeep.test.ts#L94))
- **FR4.2: Without a floor a line-starting sweep starts nothing.** `runSpecUpkeepTick` answers a summary that says no external floor is configured.
- **FR5: A courier CronJob posts a station. It does not run the job.** `templates/courier-cronjob.yaml` in `deploy/chart/charts/stations-helm` renders one CronJob per `courierJobs` entry, named `lore-stations-courier-<name>`. The pod runs `curl` once against the entry's `path` on the stations service and holds no business logic.
- **FR5.1: Courier policy.** Every courier CronJob sets `concurrencyPolicy: Forbid`, `startingDeadlineSeconds` (300 by default), bounded job history, `restartPolicy: Never`, `backoffLimit: 2` and `activeDeadlineSeconds: 120`.
- **FR5.2: Courier pods are bounded.** Every courier pod sets CPU and memory `requests` and `limits` (10m / 32Mi, 100m / 64Mi), runs as non-root with a read-only root filesystem and no capabilities, and mounts no service account token.
- **FR5.3: The token never appears in argv.** The pod writes the bearer header from `LORE_INGEST_TOKEN` to a curl config file with a shell builtin, then runs `curl --config`.
- **FR5.4: A slow sweep sets its own post time and retries.** An entry may set `maxTimeSeconds` (30 by default) and `retries` (3 by default). `consolidation` sets 110 seconds and 0 retries, because a retried post would store the same patterns twice.
- **FR5.5: The chart renders in CI.** `scripts/check-charts.sh` lints and renders the stations chart with the fixture `infra/chart-ci-values/stations-helm.yaml`, which carries one courier entry with a body and one without.
- **FR6: `POST /api/stations/<name>` runs the named sweep and returns its summary.** The answer is `200` with `{ job, summary }`, where `summary` is the sweep's one-line result. ([validated by runs the named station and returns the summary it reported @5dd32784](apps/stations/src/transport/routes/stations.test.ts#L30), [validated by includes the station name as 'job' in the 200 body, so a courier or operator can confirm which station ran @a9f34a58](apps/stations/src/transport/routes/stations.test.ts#L101))
- **FR6.1: An unknown name is `404`.** A courier typo must not read as success. ([validated by refuses a name no station answers to, rather than 500-ing on undefined @b27d6454](apps/stations/src/transport/routes/stations.test.ts#L40))
- **FR6.2: A caller with no bearer token is refused with `401`.** ([validated by refuses a caller with no bearer token @6e739045](apps/stations/src/transport/routes/stations.test.ts#L47))
- **FR6.3: A failing sweep answers `500` and nothing else.** The courier's only channel is an HTTP status, and a job's error can carry connection strings and hostnames. The detail is logged in the stations service and never returned. ([`stations.test.ts@ecc7f5c3`](apps/stations/src/transport/routes/stations.test.ts#L110))
- **FR6.4: A sweep does not run twice at once.** A post that arrives while the same sweep is running is refused with `409`. The latch is freed when the run ends, whether it succeeded or failed. ([validated by refuses a second concurrent run of the same station @1e50d84c](apps/stations/src/transport/routes/stations.test.ts#L56), [validated by frees the latch after a run so the next tick is not locked out forever @c2c50248](apps/stations/src/transport/routes/stations.test.ts#L81), [validated by frees the latch after a FAILED run, so one error does not wedge the station @7bf71029](apps/stations/src/transport/routes/stations.test.ts#L87))
- **FR6.5: The request body is the sweep's params.** A JSON object body is handed to the sweep, and a post with no body hands it empty params. ([validated by hands the JSON body {repo: re-cinq/lore, weeks: 8} to the station as its params @67732d24](apps/stations/src/transport/routes/stations.test.ts#L131), [validated by hands empty params to the station when the request has no body @a0c6df70](apps/stations/src/transport/routes/stations.test.ts#L154))
- **FR6.6: Only a sweep with an `http` trigger answers by URL.** The route's registry holds every sweep whose manifest declares `{ kind: "http" }` and no other. ([validated by answers to every station in the shared registry that declares an http trigger @4a2638e4](apps/stations/src/events/runner/service-stations.test.ts#L16), [validated by does not expose a station that declares no http trigger, so a node cannot be run by URL @eb1cc54b](apps/stations/src/events/runner/service-stations.test.ts#L26))
- **FR6.7: A courier-posted run writes no `pipeline.job_runs` row.** Its record is the Kubernetes Job history and the stations pod log. The summary goes back in the HTTP answer only.
- **FR7: On-demand run.** Any sweep with an `http` trigger can be run by posting `POST /api/stations/<name>` with the ingest token. A courier job can also be run with `kubectl create job --from=cronjob/lore-stations-courier-<name>`. A tick job can also be run by inserting its `cron.<job>.tick` event into `pipeline.events`.
- **FR8: A courier job's schedule lives in the chart.** The sweep's manifest also carries the schedule as a `cron` trigger, for the reader. Nothing in the stations service fires on it, and nothing checks that the two agree. A manifest's schedule has five fields. ([validated by declares a cron schedule with five fields, so the emitter can read it @eaaf12b1](apps/stations/src/work/registry.test.ts#L41))
- **FR9: `memory-ttl` expires memories whose `expires_at` has passed and reports the count.** ([validated by expires only memories whose expires_at has passed @a00664d5](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L367), [validated by runs a registry station against the host this process supplies @6da896f7](apps/stations/src/events/runner/service-stations.test.ts#L36))
- **FR9.1: `importance-decay` evicts past the per-agent cap and ages facts.** Only the count above the cap is evicted, the highest-scoring memory survives, an agent under the cap loses nothing, one `importance-decay` audit entry is written per agent evicted from, and the summary names memories, facts and stale transitions, reporting zero for each path with nothing to do. Ageing facts to `stale` is non-fatal, so a completed eviction is still reported. ([validated by `importance-decay.test.ts@03c0b955`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L37), [`importance-decay.test.ts@83ab60e8`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L49), [`importance-decay.test.ts@e7b81fee`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L59), [`importance-decay.test.ts@6ac50ca4`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L72), [`importance-decay.test.ts@4eff9618`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L84), [`importance-decay.test.ts@87e747a7`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L111), [`importance-decay.test.ts@a4e5d90c`](apps/stations/src/work/importance-decay/importance-decay.test.ts#L132))
- **FR9.2: A failed fact purge does not stop `importance-decay`.** Memories are still evicted and stale facts still transition when the purge of invalidated facts throws. ([validated by still evicts memories and transitions stale facts when the purge throws @903563e1](apps/stations/src/work/importance-decay/importance-decay.test.ts#L154))
- **FR9.3: `anthropic-cost-sync` skips without its key.** `ANTHROPIC_ADMIN_KEY` is an optional secret reference on the stations deployment (`anthropicAdminKeySecret`). With the key unset the sweep reports a skip and does not fail. ([validated by `anthropic-cost-sync.test.ts@71e31aa3`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L10))
- **FR9.4: `gcp-cost-sync` skips without its billing settings.** With either of the two billing env vars unset the sweep reports a skip and does not fail. ([validated by returns a skip summary without throwing when the billing env is unset @5bf3b1ae](apps/stations/src/work/gcp-cost-sync/gcp-cost-sync.test.ts#L6), [validated by skips when only one of the two billing env vars is set @8e663bb4](apps/stations/src/work/gcp-cost-sync/gcp-cost-sync.test.ts#L12))
- **FR9.5: `consolidation` skips when it has nothing to do.** It calls no model without `ANTHROPIC_API_KEY`, and it skips when the last 7 days hold fewer than 5 valid facts. ([validated by skips, calling no model, when no ANTHROPIC_API_KEY is set @2ec80f71](apps/stations/src/work/consolidation/consolidation.test.ts#L10), [validated by skips with 0 recent facts, 5 being the least worth consolidating @a1303d40](apps/stations/src/work/consolidation/consolidation.test.ts#L18))
- **FR9.6: `consolidation` keeps only the model's `PATTERN:` lines.** Prose around them is dropped, a `NONE` reply yields nothing, and a pattern of 10 characters or fewer is dropped. ([validated by extracts PATTERN: prefixed lines and drops the prose around them @5a7f4b6a](apps/stations/src/work/consolidation/consolidation.test.ts#L28), [validated by returns nothing for a NONE reply, which carries no prefix @400635ce](apps/stations/src/work/consolidation/consolidation.test.ts#L42), [validated by keeps 11 characters and drops 10, the filter being length > 10 @fbc60b53](apps/stations/src/work/consolidation/consolidation.test.ts#L46))

## Acceptance Criteria

1. The scheduler clears a job's in-flight marker on every failure path. A rejected run start (a `pipeline.job_runs` insert failure) is logged with no failure record, and the job runs again on the next check. A handler failure passes its message to the run's failure and leaves the job due again. ([validated by runs the job again on the next tick after starting its run rejects @c5ed91a7](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L76), [validated by records no failure when starting the run itself rejects, since there is no row to fail @92050202](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L100), [validated by fails the run with the handler's error and leaves the job due again @038eec62](libs/shared/src/work/scheduler/cron-scheduler.test.ts#L114))
2. Five courier CronJobs render from `courierJobs`, one per courier job in the classification table, with the schedules listed there.
3. Fourteen ticks are emitted, one per tick job in the classification table, with the schedules listed there. ([validated by schedules webhook_ensure weekly on Monday at 03:00 UTC @53052053](libs/shared/src/work/scheduler/cron-emitters.test.ts#L39), [validated by schedules utopia_backfill weekly on Sunday at 02:30 UTC @8c20fe8f](libs/shared/src/work/scheduler/cron-emitters.test.ts#L45))
4. The Anthropic cost sync parses the Admin cost and usage reports: the cents-string amount becomes dollars, the 1h and 5m ephemeral cache-creation buckets are summed, and cost is joined to tokens per date and model. ([validated by `anthropic-cost.test.ts@eef9a9a5`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost.test.ts#L9), [`anthropic-cost.test.ts@9b93008f`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost.test.ts#L37), [`anthropic-cost.test.ts@075d8caf`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost.test.ts#L73), [`anthropic-cost.test.ts@b5b96229`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost.test.ts#L92))
5. What survives of `context_reindex` is legacy relocation (issue #979, FR-20.21 in `specs/1-lore-platform/spec.md`), driven by the `internal.repo.team_changed` handler in the stations service: any rows a team-resolved repo still holds in `org_shared.chunks` move into its resolved schema, and a relocation that targets `org_shared` itself is refused. ([validated by `chunks.test.ts@a5f32c65`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L604), [`chunks.test.ts@c13bc53d`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L667), [`chunks.test.ts@3a76936a`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L678), [validated by moves re-cinq/lore's legacy org_shared rows into platform, the schema its team resolves to @eba11ff8](apps/stations/src/events/team-changed.test.ts#L26), [validated by relocates nothing for a repository whose team resolves to org_shared @05f119f7](apps/stations/src/events/team-changed.test.ts#L37))

## File Changes

Where the scheduling code lives today.

| File | Role |
|------|------|
| `libs/shared/src/work/scheduler/cron-emitters.ts` | `CRON_EMITTERS`: every tick with its schedule |
| `libs/shared/src/work/scheduler/cron-scheduler.ts` | `createCronScheduler` (due check, run tracking) and `registerCronEmitters` (tick insert) |
| `libs/shared/src/outbound/project/job-runs/` | `JobRunsPort` with its Postgres adapter and in-memory double |
| `apps/stations/src/index.ts` | `startCronTicks`: wires the scheduler to the event reporter at boot |
| `apps/stations/src/work/<sweep>/manifest.ts` | a sweep's name and triggers (`event`, `cron`, `http`) |
| `apps/stations/src/work/registry.ts` | every sweep, by name |
| `apps/stations/src/events/subscriptions.ts` | the event names the service claims, derived from the manifests |
| `apps/stations/src/transport/routes/stations.ts` | `POST /api/stations/{name}` |
| `deploy/chart/charts/stations-helm/values.yaml` | `courierJobs` and the courier image |
| `deploy/chart/charts/stations-helm/templates/courier-cronjob.yaml` | one CronJob per `courierJobs` entry |
| `infra/chart-ci-values/stations-helm.yaml` | the CI fixture `scripts/check-charts.sh` renders |

## Limitations & Open Questions

1. **The stations service runs one replica.** Each sweep's latch against a
   second concurrent run is per process, so a second replica would not share
   it. The tick emitter itself is safe on two processes (FR1.1, FR1.2).
2. **A courier run has no row.** A courier-posted sweep leaves no
   `pipeline.job_runs` row, so `/analytics` shows tick emits only. Should a
   courier run be recorded there?
3. **A tick's row is not the sweep's result.** The row closes when the event is
   inserted. A sweep that fails afterwards is retried and dead-lettered by the
   event bus, and the hourly `bus-prune` sweep reports dead letters.
4. **Two places hold a courier job's schedule.** The chart fires on its own
   value and the manifest's `cron` trigger is not read. Should one be derived
   from the other, or checked against it?
5. **Gap detection has no replacement yet** (#2333).
