---
adr_number: 19
title: "Scheduled job runtime split: in-process scheduler ↔ K8s CronJobs"
status: accepted
date: 2026-06-02
domains: [agent, scheduling, infra, k8s]
supersedes: "Scheduling decision in 5-lore-agent (Problem #5, FR-6, SC#2)"
---

# ADR-019: Scheduled job runtime split (in-process scheduler ↔ K8s CronJobs)

## Context

[ADR — 5-lore-agent spec] consolidated all periodic work into a single
in-process `node-cron` scheduler inside the always-on `lore-agent` process. At
the time that was the right call: scheduling had been scattered across K8s
CronJobs and polling loops in the MCP server (5-lore-agent Problem #5), and
pulling it into one place — Vision "run all scheduled maintenance jobs from one
place", FR-6, and Success Criterion #2 "run without K8s CronJob configuration" —
removed real operational sprawl. There were **5** jobs.

The agent now registers **16** jobs (`agent/src/index.ts`), spanning two
profiles the one scheduler serves badly at the heavy end:

- **Hot-path / sub-minute** — `merge_check`, `approval_check`,
  `loretask_watcher`, `spec_task_executor` (`*/1`), plus `review_reactor` and
  `stale_task_check`. These want the resident process: a pod-per-tick is pure
  churn, and several are coupled to the agent's webhook trigger endpoints and
  warm in-memory state (DB pool, Octokit client, prompt-cache break tracker).
- **Heavy / infrequent batch** — `context_reindex`, `gap_detection`,
  `spec_drift`, `spec_test_linker`, `eval_runner`, `context_core_builder`,
  `autoresearch`, `memory_ttl`, `importance_decay`, `consolidation`. Weekly or
  daily, LLM-cost-spiky, long-running, sharing none of the warm state.

Running the heavy batch jobs in-process has bitten us in four concrete ways:

1. **Single-replica pin.** In-process crons have no leader election, so a second
   replica double-fires every job. `lore-agent` is therefore stuck at
   `replicas: 1` — no HA for the webhook/health path.
2. **Silently missed runs.** If the one pod is restarting at the scheduled
   minute, `node-cron` skips the tick with no catch-up. A missed **weekly** job
   is a 7-day gap. (This surfaced concretely: `spec_test_linker` could not run
   for a week because the agent image rolled after its Monday slot.)
3. **No isolation.** A long LLM-heavy batch run competes for CPU/memory with the
   webhook hot path in the same process; a hang or spike degrades trigger
   handling.
4. **No independent controls or trigger.** No per-job retry/backoff, timeout,
   concurrency policy, resource limits, run history, or per-run logs — and
   running a job on demand requires `kubectl exec`-ing into the agent pod to
   invoke the compiled module by hand.

The codebase already has the building blocks for the alternative:
`agent/src/supervisor/runner-cli.ts` and `repo-validation-cli.ts` are existing
"run one thing in a pod via a CLI entrypoint" patterns, and the agent image
bakes the full `dist/`.

## Decision

Adopt a **hybrid runtime split**, drawn on cadence + coupling:

1. **In-process stays for hot-path/sub-minute/webhook-coupled jobs** — the 6
   listed above keep their `registerJob` registration in the resident agent.
2. **Heavy/infrequent batch jobs become Kubernetes CronJobs** — the 10 listed
   above each run in their own pod.
3. **One generic runner.** `agent/src/job-runner.ts` →
   `node dist/job-runner.js <jobName>`: `initPool()`, dispatch to the named job,
   exit `0/1`. One image, one dispatch table — no per-job entrypoint or image.
   Reuses the established `runner-cli.ts` pattern.
4. **Templated Helm CronJobs.** A single `cronjob.yaml` ranges over a `cronJobs`
   values list; the pod env/secrets/`serviceAccountName` come from a shared
   `_env.tpl` reused by the Deployment so the two cannot drift. Each CronJob sets
   `concurrencyPolicy: Forbid` (preserving 5-lore-agent's "jobs do not overlap"
   rule), `startingDeadlineSeconds` (the missed-run catch-up node-cron lacked),
   and bounded job history.
5. **Structural signal.** `agent/src/jobs/cron/` (K8s CronJob — separate
   container) and `agent/src/jobs/scheduled/` (in-process — agent container),
   each with a `README.md` naming the runtime, so the split is obvious from the
   tree.
6. **Atomic cutover.** A job's CronJob is added and its `registerJob` line
   removed in the same release — never both, never neither.

Full requirements, the job classification table, and acceptance criteria live in
[`specs/scheduled-job-runtime-split/`](../specs/scheduled-job-runtime-split/spec.md).

### Alternatives considered

- **Keep everything in-process (status quo).** Rejected — it is the source of
  the single-replica pin, the silently missed weekly runs, and the lack of
  isolation/triggering. Correct at 5 jobs; strained at 16.
- **Move *all* 16 jobs to K8s CronJobs.** Rejected — the `*/1` watchers would
  spawn a pod every 60 seconds (image pull + scheduling overhead), lose warm
  state, and decouple from the webhook trigger endpoints they pair with. The
  churn outweighs any isolation benefit for sub-minute work.
- **Leader-elect the in-process scheduler** (so the agent can scale to >1
  replica while keeping all jobs in-process). Rejected for now — it solves the
  HA pin but not the isolation, missed-run, or on-demand-trigger problems, and is
  a larger change. May still be pursued separately for the remaining in-process
  jobs.
- **Adopt an external workflow engine (Argo Workflows / CronWorkflows).**
  Rejected — heavyweight new dependency and control plane for ~10 single-step
  jobs that plain K8s CronJobs + a CLI cover.

## Consequences

- **Positive:** batch jobs gain isolation, per-job resource/retry/timeout limits,
  `concurrencyPolicy: Forbid`, native missed-run catch-up
  (`startingDeadlineSeconds`), per-run pod logs, and a free
  `kubectl create job --from=cronjob/<name>` manual trigger (retiring the
  pod-exec workaround). Schedules become declarative in `values.yaml`.
- **Run-tracking parity (required, not optional):** the in-process scheduler
  records every run in `pipeline.job_runs` (surfaced in the web-ui `/analytics`
  view). The `job-runner` CLI **must** replicate that bookkeeping, or migrated
  jobs silently vanish from run tracking. The shared write path is extracted so
  scheduler and runner cannot diverge.
- **Output retention:** `result_summary` is a one-liner; the full run output is
  persisted to GCS via the existing redacted/CMEK log-storage path (reused from
  task pod logs), referenced by a new `pipeline.job_runs.log_path`, and surfaced
  in the UI/MCP like task logs. Clean for CronJob pods (one job per stdout);
  isolated in-process capture is a noted follow-up.
- **Negative / accepted:** CronJob pods cold-start and lose the in-memory
  prompt-cache break tracker, so the first LLM call per run is a cache write —
  acceptable at weekly/daily cadence. Schedules now live in Helm values rather
  than `index.ts`; the spec's classification table is the reference of record.
- **Unchanged:** the agent stays `replicas: 1` — the 6 remaining in-process
  crons still preclude HA without leader election (explicitly out of scope).
- **Supersedes** the scheduling portion of 5-lore-agent: Problem #5's "no K8s
  CronJobs" framing, FR-6's all-in-process scope, and SC#2's "without K8s CronJob
  configuration" now apply only to the in-process subset; the batch subset is
  CronJob-scheduled by design.
