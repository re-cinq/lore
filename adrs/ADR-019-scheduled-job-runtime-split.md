---
adr_number: 19
title: "Scheduled job runtime split: in-process scheduler ↔ K8s CronJobs"
status: in progress
date: 2026-06-02
domains: [agent, scheduling, infra, k8s]
supersedes: "Scheduling decision in 5-lore-agent (Problem #5, FR-6, SC#2)"
---

# ADR-019: Scheduled job runtime split (in-process scheduler ↔ K8s CronJobs)

Splits the agent's scheduled jobs by cadence, keeping hot-path and sub-minute jobs in the resident scheduler while moving heavy, infrequent batch jobs to isolated Kubernetes CronJobs with retry, missed-run catch-up, and per-run logs.

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
  `loretask_watcher`, `spec_task_executor` (`*/1`), and `stale_task_check`
  (`review_reactor` was retired in 2026-07 — see [ADR-012](./ADR-012-autonomous-review-loop.md)).
  These want the resident process: a pod-per-tick is pure
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

## Amendment (2026-07): detection family returns in-process as event-driven assembly lines

The four detection jobs — `gap_detection`, `spec_drift`, `spec_coverage_validate`,
`spec_coverage_backfill` — left the K8s CronJob carve-out. Each is now **defined
as an assembly line** (`libs/assembly-lines/src/assembly-lines/{gap-detect,
spec-drift,spec-coverage-validate,spec-coverage-backfill}.yaml`, a two-node
`detect → done` graph) and **started by an event**: an in-process cron emitter
inserts `cron.<job>.tick` at the historic cadence, the tick handler
(`apps/floor/src/jobs/detect/fan-out.ts`) enumerates target repos, pre-creates
the `<job_ref>:<repo>` `pipeline.job_runs` row, and calls
`assemblyLines().start(<definition>, {repo, branch, args:{job_run_id}})` per
repo. *(Amended 2026-07: the dedicated repo-less runner was retired — detection
lines ride the standard event-driven walk (spec 6-dark-factory FR6.9); the
branch name `detect/<definition>/<repo>` is the overlap-guard key, and
`advanceLine` closes the job_run at the line's terminal state.)*

Why the original objections no longer bind this family:

1. **Missed runs (objection #2).** The scheduler is no longer fire-and-forget
   node-cron: it compares `cron-parser` `prev()` against DB-persisted
   `jobRuns().lastRun()` every 30s plus `checkMissedRuns()` at boot, and tick
   inserts dedupe per minute slot — DB-backed catch-up equivalent to
   `startingDeadlineSeconds`.
2. **Isolation (objection #3).** Accepted at the new granularity: one run
   covers one repo, not the whole org, and the start handler
   fire-and-backgrounds so the drain loop is never blocked. If a detect node
   ever needs real isolation, the node-handler seam allows dispatching it to an
   Agent CR without touching the YAML.
3. **Independent controls (objection #4).** Event-bus retry/dead-letter (per
   repo, since each start event is its own row), the per-run branch lease
   (concurrency control, replacing `concurrencyPolicy: Forbid`), and
   first-class `pipeline.assembly_lines` identity with per-node trace replace
   the CronJob knobs.
4. **On-demand trigger (objection #5).** Insert the tick event, optionally
   scoped: `INSERT INTO pipeline.events (event_name, source, params) VALUES
   ('cron.spec_drift.tick', 'cron', '{"repo":"owner/name"}')`.

Run-tracking parity is kept: each per-repo run writes a `pipeline.job_runs` row
named `<job>:<repo>` (suffixed so the emitter's bare-name row remains the
missed-run catch-up marker). GCS log capture is deliberately dropped for these
runs (console logs + the job_runs summary suffice at per-repo size); isolated
in-process capture remains the noted follow-up.

The heavy batch jobs (`context_reindex`, `eval_runner`, `context_core_builder`,
`importance_decay`, `consolidation`, `memory_ttl`, `anthropic_cost_sync`) stay
as K8s CronJobs — the carve-out still holds where runs are org-wide, memory-heavy,
or hours long. The detection pattern (`detect` node + tick fan-out) is the
intended porting path for any of them that can be made per-repo.

## Amendment (2026-07): `context_reindex` verification sweep — `ingested_at` becomes a verification stamp (issue #967)

`gap_detection`'s stale-content signal was born broken and no prior ADR or spec
ever specified it: the count read a hardcoded `org_shared.chunks` while the
very same commit's reindex already resolved per-team schemas, and incremental
reindex never re-stamped unchanged files — so "chunks not re-ingested in >90
days" was the permanent steady state of every stable doc, and gap-detect
re-filed the same un-completable `gap-fill` task weekly, forever.

**Decision.** Every per-repo `context_reindex` pass now ends with a
verification sweep (`apps/floor/src/jobs/context-jobs/reindex/verify.ts`):
chunks the reindex job owns whose files still exist in the repo tree get
`ingested_at` re-stamped; owned chunks of deleted files are pruned. This
redefines the semantics rather than restoring any prior intent:

- For reindex-owned rows, `ingested_at` means **"last verified against the
  repo tree"**, not "last content change".
- `staleChunkCount` counts only reindex-owned rows in the repo's **resolved**
  schema; a count past the floor means **reindex has stopped covering the
  repo** (broken job, dropped repo) — an actionable, clearable signal.

**Boundaries and guards.**

- Ownership is `metadata->>'ingested_by' = 'reindex-job'`. API- and UI-ingested
  chunks are never counted, touched, or pruned. Migration 0034 backfills the
  marker onto legacy seed-scope rows only — deliberately narrower than
  everything reindex ever wrote, because provenance-less rows outside seed
  scope include non-reindex writers whose "files" are not in the repo tree.
- Spec reassembly keys off `metadata.chunk_index` (issue #978), so re-stamps
  may move a whole file to one shared `NOW()` timestamp.
- A 30-day file-level age gate keeps steady-state nights from rewriting every
  row (each rewrite copies the embedding into a new MVCC row version).
- An empty tree skips the sweep, and `listTree` throws on GitHub's recursive
  truncation flag — a partial file list must never read as mass deletion.

**Accepted / follow-ups.** Legacy pre-provenance rows outside seed scope are
relocated by migration 0035 (issue #979) from `org_shared.chunks` into each
repo's resolved team schema, and — where their `content_type` is one
`classifyFile()` can return (`doc`/`code`/`adr`/`spec`) — adopted by the sweep
via `ingested_by = 'reindex-job'`; rows with a non-classifiable `content_type`
(pseudo-path writers such as `rule` / `pull_request`) are relocated but remain
unowned ([validated by `migration-0035.test.ts:45`](apps/lore-api/src/features/agents/migration-0035.test.ts#L45))

The relocation is also self-healing at runtime (the migration handles the
past; this handles the future): the nightly reindex opens every
team-resolved per-repo pass by relocating any rows still stranded in
`org_shared.chunks` (so a team assigned after ingestion converges within one
night regardless of how the column was written), and a team change made
through the settings route emits `internal.repo.team_changed`, whose Floor
handler relocates immediately — the same port method
(`relocateLegacyChunks`, FR-20.21) behind both. Only the
`org_shared → team` direction is automated; clearing a team or moving
between two team schemas still strands rows in the old schema and remains a
manual operation.

The relocation's guarantees:

- The loop targets only real team schemas resolved from `lore.repos`, never
  `org_shared` itself ([validated by `migration-0035.test.ts:66`](apps/lore-api/src/features/agents/migration-0035.test.ts#L66))
- A file already fresh in the target schema keeps its team-schema copy; only
  files absent from the target move, guarded per repo + file_path ([validated by `migration-0035.test.ts:19`](apps/lore-api/src/features/agents/migration-0035.test.ts#L19))
- Copy and delete run as one statement sharing one snapshot, and the delete
  removes only copied rows or stale duplicates — never a delete without a
  copy ([validated by `migration-0035.test.ts:26`](apps/lore-api/src/features/agents/migration-0035.test.ts#L26))
- The generated `search_tsv` column is omitted from the INSERT list ([validated by `migration-0035.test.ts:36`](apps/lore-api/src/features/agents/migration-0035.test.ts#L36))
- Schema, repo, and team values are interpolated only via `format %I`/`%L` ([validated by `migration-0035.test.ts:51`](apps/lore-api/src/features/agents/migration-0035.test.ts#L51))
- Repos the `lore` runner cannot write are skipped with a NOTICE instead of
  failing the deploy ([validated by `migration-0035.test.ts:61`](apps/lore-api/src/features/agents/migration-0035.test.ts#L61))

Api-owned orphans of deleted files are still never pruned by anything —
closing that needs a GitHub tree read and belongs in the reindex `verify.ts`
sweep as a follow-up (widen the prune to `ingested_by = 'api'`). Spec
statements: FR-10.8 / FR-20.6 in `specs/1-lore-platform/spec.md`, statement 11
in `specs/scheduled-job-runtime-split/spec.md`.
