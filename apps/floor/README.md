# Lore Floor (`@re-cinq/lore-floor`)

The long-running **Floor** runtime — the factory's coordinator. It processes
pipeline tasks via the Anthropic API, dispatches Agents onto Stations
(Kubernetes Job pods or local sandboxes), runs the scheduled job registry, and
reaps leases. See [ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md)
for the Factory ⊃ Floor ⊃ AssemblyLine ⊃ Station ⊃ Agent vocabulary.

This deployment was historically called "Lore Agent"; it is now the Floor
(`apps/floor`, the `lore-floor` namespace/deployment). "Agent" now means only a
single Claude-CLI/API-plus-prompt run.

## Responsibilities

- **Task processing** — picks up pipeline tasks, hydrates context from the Lore
  API, runs them via direct Anthropic API calls (simple) or by dispatching Agent
  CRs to the ai-agent-subsystem (agent-cr, implementation/review).
- **Scheduling** — an in-process scheduler for sub-minute, hot-path, and
  webhook-coupled jobs; batch jobs run as standalone CronJob pods.
- **Dark Factory supervisor** — drives the branch-as-state AssemblyLine workflow
  (one Agent CR per node), emitting `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:`
  commit trailers so a run can resume after interruption (ADR-016/031).
- **Auto-merge, escalation, leases, audit** — the operational machinery around
  autonomous task runs.

## Layout

The source is sliced **vertically by domain** — each top-level folder under
`src/` owns its port + implementation + orchestration + colocated tests (the
`libs/shared/src/project/<domain>/` pattern). Two folders are special: `kernel/`
is the shared substrate every domain may import and that imports nothing above
it; `delivery/` is the entry-point tier (the `dist/delivery/*` deploy contract)
that nothing else imports. The invariant is enforced by
[`src/domain-boundaries.test.ts`](./src/domain-boundaries.test.ts).

```
src/
  kernel/         shared substrate: db pool, config, agent-invocation,
                  repositories/, platform-port.ts (CodePlatform) — imported by all
  composition/    project-boot.ts — the wiring root (the one place impls are wired)
  delivery/       entrypoints (FROZEN deploy paths): index, job-runner,
                  gen-catalog, health
  station/        Station execution — the agent-cr StationBackend (Agent CR
                  dispatch) + kube plumbing
  assembly-line/  the workflow graph of Stations (floor-graph + run)
  agent/          Agent-CR catalog seed + telemetry sink
  task/           the worker, orchestrator, and per-task-type handlers
  spec-trace/     spec→test graph ingest, audit, drift, coverage backfill/validate
  watcher/        Agent CR → PR watcher
  merge/          auto-merge decision + triggers + merge-outcome capture
  dark-factory/   dark-mode settings, approval ceremony, audit, baseline
  platform/       GitHub (CodePlatform impl), PR policy/copy, escalation
  lease/  memory/  cost/  review/  scheduling/  context-jobs/   (one domain each)
```

Cron/scheduled jobs live with the domain they serve (e.g. `memory-lifecycle`
under `memory/`, `spec-drift` under `spec-trace/`); `delivery/job-runner.ts`
dispatches them by name.

## Develop

```bash
npm install                          # from the repo root (workspace member)
npm run build -w @re-cinq/lore-floor
npm test  -w @re-cinq/lore-floor
```

Depends on the workspace libraries `@re-cinq/lore-shared` and
`@re-cinq/lore-runner` — build those first, or use the root
`npm run build` which orders them.

For a full local stack (Postgres + all four services with live reload), run
`npm start` from the repo root.

### Running a job by hand

```bash
npm run job -w @re-cinq/lore-floor -- <jobName>   # e.g. gap_detection, spec_drift
npm run jobs:all -w @re-cinq/lore-floor           # run every batch job in sequence
```

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile) (multi-stage; mirrors the
`apps/` + `libs/` workspace layout so the symlinked workspace deps resolve at
runtime). `CMD` runs `dist/delivery/index.js`, exposing the health server on
port 8080. Deployed to the `lore-floor` namespace on GKE via Terraform/Helm —
see [`infra/`](../../infra) and the root README.
