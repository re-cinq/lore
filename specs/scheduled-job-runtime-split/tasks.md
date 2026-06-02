# Tasks: Scheduled Job Runtime Split

## Phase 1 — Folder reorg (no behavior change)

- [x] T001 Create `agent/src/jobs/cron/` and move the 10 batch-job files into it (`reindex`, `gap-detect`, `spec-drift` + `spec-drift-rules` + its test, `spec-test-linker` + its test, `eval-runner`, `context-core-builder`, `autoresearch`, `memory-lifecycle`, `ttl-cleanup`); fix import depth (`../` → `../../`, same-folder siblings stay `./`)
- [x] T002 Create `agent/src/jobs/scheduled/` and move the 6 in-process job files (`merge-check`, `approval-check`, `review-reactor`, `loretask-watcher`, `spec-task-executor`, `stale-task-check`); fix import depth, and repoint `loretask-watcher`'s `./auto-merge-trigger` (stays at `jobs/` root) to `../auto-merge-trigger`
- [x] T003 [P] Add `agent/src/jobs/cron/README.md` — "each file runs as its own Kubernetes CronJob pod (separate container); schedule + manifest in agent-helm `cronjob.yaml`/`values.yaml`"
- [x] T004 [P] Add `agent/src/jobs/scheduled/README.md` — "runs in-process inside the `lore-agent` container via node-cron, registered in `index.ts`"
- [x] T005 Repoint importers: `index.ts` (6 in-process imports → `scheduled/`) and `health.ts` (`review-reactor` → `scheduled/`); `agent` typecheck passes

## Phase 2 — Generic runner

- [ ] T006 Add `agent/src/job-runner.ts`: parse job name argv, `initPool()`, dispatch table mapping the 10 names → job functions in `jobs/cron/`, run, log summary, `process.exit(0|1)`; unknown name → non-zero with message
- [ ] T006a Record the run in `pipeline.job_runs` (insert `running`; update `completed` + `result_summary` / `failed` + `error`), mirroring `scheduler.ts` `runJob` — extract the shared bookkeeping into `agent/src/lib/job-run.ts` so the scheduler and runner can't diverge. Keeps CronJob runs in `/analytics`
- [ ] T006b Migration `NNNN_job_runs_log_path.sql`: `ADD COLUMN log_path TEXT` (idempotent). Add `writeJobRunLogs`/`readJobRunLogs` to `lib/log-storage.ts` (key `__job_runs__/<job>/<runId>/output.log`, redacted + CMEK). Runner tees stdout/stderr, uploads on exit, sets `log_path`
- [ ] T006c [P] `get_job_logs` MCP tool + a job-run log view (mirror `get_task_logs` / `TaskLogs.tsx`); link from `/analytics` job_runs rows to the output
- [ ] T007 [P] Unit test `agent/src/job-runner.test.ts`: dispatch resolves each known name; unknown name is rejected (pure dispatch map, no live job execution)

## Phase 3 — Remove from in-process scheduler

- [ ] T008 Delete the 10 migrated `registerJob` lines + their imports from `index.ts`; leave the 6 in-process registrations intact

## Phase 4 — Helm CronJobs

- [ ] T009 Extract the Deployment env block into `agent-helm/templates/_env.tpl` (`define "lore-agent.env"`); update `deployment.yaml` to consume it (no rendered diff)
- [ ] T010 Add `agent-helm/templates/cronjob.yaml`: range over `.Values.cronJobs`, one `CronJob` each — `command: ["node","dist/job-runner.js","{{ .job }}"]`, shared env/SA, `concurrencyPolicy: Forbid`, `startingDeadlineSeconds`, history limits, `restartPolicy: Never` + `backoffLimit`, `activeDeadlineSeconds`, and a `resources` block merging per-job overrides over the default
- [ ] T011 Add to `agent-helm/values.yaml`: `cronJobDefaults` (resources requests+limits, activeDeadlineSeconds, startingDeadlineSeconds, backoffLimit, history limits) + the `cronJobs` list (10 entries: name, schedule, job, optional resources/deadline overrides — bump memory/deadline for `context_reindex`, `eval_runner`, `autoresearch`)

## Phase 5 — Verify

- [ ] T012 `agent` typecheck + `vitest run` green after the reorg and runner
- [ ] T013 `helm template` the agent chart: 10 CronJobs render with correct schedules, identical env to the Deployment, the documented policies, and non-empty `resources.{requests,limits}` + `activeDeadlineSeconds` on every one (heavy jobs higher than cleanups); confirm AC 1–8 incl. 1a/1b/5a
- [ ] T014 Post-deploy smoke: `kubectl create job --from=cronjob/spec-test-linker` runs and exits 0; confirm no job is both registered in-process and a CronJob
