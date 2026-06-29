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

- **Event bus (the trigger substrate)** — a single `pipeline.events` table in 3
  layers (ADR-015 amendment): **listeners** capture occurrences as rows (the
  GitHub webhook ingress `POST /api/webhook/github`, the Kubernetes Agent-CR
  watch, the cron emitters, mcp-server post-ingest); **the loop** atomically
  claims runnable rows and dispatches by `event_name` via a registry, with
  retry/backoff → dead-letter + a reaper; **tasks/jobs** are the existing handlers.
  Event names are source-prefixed (`github.*` / `kubernetes.*` / `cron.*` /
  `internal.*`). Heavy batch jobs stay as K8s CronJobs (carve-out, ADR-019).
- **Task processing** — picks up pipeline tasks, hydrates context from the Lore
  API, runs them via direct Anthropic API calls (simple) or by dispatching Agent
  CRs to the ai-agent-subsystem (agent-cr, implementation/review).
- **Scheduling** — an in-process scheduler whose ticks *emit* `cron.<job>.tick`
  events (the loop runs them); heavy batch jobs run as standalone CronJob pods.
- **Dark Factory supervisor** — drives the branch-as-state AssemblyLine workflow
  (one Agent CR per node), emitting `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:`
  commit trailers so a run can resume after interruption (ADR-016/031).
- **Auto-merge, escalation, leases, audit** — the operational machinery around
  autonomous task runs.

## Layout

The source is sliced **vertically by domain** — each top-level folder under
`src/` owns its port + implementation + orchestration + colocated tests (the
`libs/shared/src/project/<domain>/` pattern). Special citizens: `src/index.ts`
is the application entry (the `dist/index.js` the container runs), top of the
tree, may import anything; `kernel/` is the shared substrate every domain may
import and that imports nothing above it; `delivery/` holds the remaining entry
points + the health module (`dist/delivery/*` deploy contract), imported by
nothing but the root entry. The invariant is enforced by
[`src/domain-boundaries.test.ts`](./src/domain-boundaries.test.ts).

```
src/
  index.ts        the application entry — boots scheduler + worker + health
                  (dist/index.js; the container CMD)
  kernel/         shared substrate: db pool, config, agent-invocation,
                  repositories/, platform-port.ts (CodePlatform) — imported by all
  composition/    project-boot.ts — the wiring root (the one place impls are wired)
  delivery/       other entry points (job-runner, gen-catalog) + health module
  station/        Station execution — the agent-cr StationBackend (Agent CR
                  dispatch) + kube plumbing
  assembly-line/  the workflow graph of Stations (floor-graph + run)
  agent/          Agent-CR catalog seed + telemetry sink
  events/         the event bus (ADR-015): listeners/ (github-webhook, k8s-watch,
                  scheduler-emitter) + loop/ (store, loop, reaper, retry) +
                  handlers/ (github, kubernetes, cron, internal) + registry.ts
  task/           the worker, orchestrator, and per-task-type handlers
  spec-trace/     spec→test graph ingest, audit, drift, coverage backfill/validate
  watcher/        Agent CR processing (processAgentCr) — driven by kubernetes.* events
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
runtime). `CMD` runs `dist/index.js`, exposing the health server on
port 8080. Deployed to the `lore-floor` namespace on GKE via Terraform/Helm —
see [`infra/`](../../infra) and the root README.
