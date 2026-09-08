# Lore Floor (`@re-cinq/lore-floor`)

The long-running **Floor** runtime — the factory's coordinator. It processes
pipeline tasks via the Anthropic API, dispatches Agents onto Stations (Agent
CRs, created through the **cluster-agent** service's `/api/cluster/*` — the
Floor holds no Kubernetes client), runs the scheduled job registry, and reaps
leases. Its three powers ([ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md)):
the events drain loop + reapers, the AssemblyRun walk + Station dispatch, and
the in-process SSE bus. See the same ADR for the Factory ⊃ Floor ⊃
AssemblyLine ⊃ Station ⊃ Agent vocabulary.

This deployment was historically called "Lore Agent"; it is now the Floor
(`apps/floor`, the `lore-floor` namespace/deployment). "Agent" now means only a
single Claude-CLI/API-plus-prompt run.

## Responsibilities

- **Event drain (the trigger substrate)** — the Floor no longer owns
  `pipeline.events`: the **event-router** service is its sole writer and serves
  the claim/ack endpoints ([ADR-044](../../adrs/ADR-044-event-router-owns-the-event-bus.md)).
  The 3 layers survive the move: **listeners** report occurrences to the router
  over HTTP (`POST /api/events`) — the Floor's own webhook/CI ingresses and
  cron emitters included; the streaming Kubernetes Agent-CR watch moved into
  the event-router, the Floor keeping only the reconcile safety net; **the
  loop** claims this Floor's delivery rows from the router and dispatches by
  `event_name` via a registry, with retry/backoff → dead-letter + a reaper;
  **tasks/jobs** are the existing handlers. Event names are source-prefixed
  (`github.*` / `kubernetes.*` / `cron.*` / `internal.*`). Heavy batch jobs
  stay as K8s CronJobs (carve-out, ADR-019); `merge_check`/`approval_check`
  handlers moved to the **stations** service.
- **Task processing** — picks up pipeline tasks and runs them via direct
  Anthropic API calls (simple) or by dispatching Agent
  CRs to the ai-agent-subsystem (agent-cr, implementation/review) — the CR
  create/read/delete going through the cluster-agent service.
- **Scheduling** — an in-process scheduler whose ticks *emit* `cron.<job>.tick`
  events (the loop runs them); heavy batch jobs run as standalone CronJob pods.
- **AssemblyRun walk** — drives the event-driven AssemblyLine walk
  (`jobs/assembly-run/`, one Agent CR per node): each node event replays the
  persisted `pipeline.station_runs` rows through `nextTransition()` to derive
  the next step; stage commits carry `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:`
  trailers as the audit substrate (ADR-016/031).
- **Auto-merge, escalation, leases, audit** — the operational machinery around
  autonomous task runs.

## Layout

The source is organized top-down as technical tiers: a tier may import the
tiers below it and never the one above. The 3 event-bus layers (ADR-015) still
describe the runtime — every trigger flows through `pipeline.events`, owned by
the event-router (ADR-044) — but they now live inside `events/`, which is one
tier rather than the organizing principle of the whole package.

`events/` receives and routes; `work/` holds one folder per job. They are
separate tiers because who dispatches a job is not the job. `src/index.ts` is
the process entry and may import anything, which is what a composition root
does. Boundaries are declared in [`layers.yaml`](../../layers.yaml) and enforced
by `lore/no-cross-layer-import` (ADR-036).

```
src/
  index.ts        the process entry — boots the loop + worker + health
  app/            project-boot.ts — the wiring root (the one place impls are wired)
  transport/      ways in: http/ (webhook/CI ingress, run-viz SSE, health) and
                  two CLI entrypoints, job-runner + gen-catalog. The compiled
                  `dist/transport/job-runner.js` is a DEPLOY CONTRACT — the Helm
                  CronJob template invokes that exact path.
  events/         receive and route (the 3 event-bus layers, ADR-015):
                  listeners/  produce: report occurrences → the event-router
                  main-loop/  drain: claim/ack seam, reaper, registry,
                              scheduling/ (cron timer), lease/ (coordination)
                  handlers/   map each event name to the job that answers it —
                              github · kubernetes · cron · internal
  work/           one folder per job, fifteen of them:
                  task/ station/ assembly-run/ agent/ watcher/ merge/ review/
                  detect/ spec-trace/ memory/ context-jobs/ dark-factory/
                  backlog/ lease/ lib/
  outbound/       every way out: db pool, queues (the lazy port singletons, incl.
                  the cluster-agent + stations + event-router HTTP clients),
                  config, archives, project-boot, single-instance
  domain/         event-types.ts — the bus contract, so a job can implement a
                  handler without importing the loop. A leaf with no I/O.
  lib/            pure helpers
```

Heavy batch jobs (under `work/context-jobs/`, `work/memory/`, …) still run as K8s
CronJob pods via `transport/job-runner.ts` (carve-out, ADR-019); the light
operational crons emit `cron.<job>.tick` events that the loop runs.

## Develop

```bash
npm install                          # from the repo root (workspace member)
npm run build -w @re-cinq/lore-floor
npm test  -w @re-cinq/lore-floor
```

Depends on the workspace libraries `@re-cinq/lore-shared` and
`@re-cinq/lore-assembly-lines` — build those first, or use the root
`npm run build` which orders them.

For a full local stack (Postgres + every service with live reload), run
`npm start` from the repo root.

### Running a job by hand

```bash
npm run job -w @re-cinq/lore-floor -- <jobName>   # e.g. eval_runner, consolidation
npm run jobs:all -w @re-cinq/lore-floor           # run every batch job in sequence
```

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile) (multi-stage; mirrors the
`apps/` + `libs/` workspace layout so the symlinked workspace deps resolve at
runtime). `CMD` runs `dist/index.js`, exposing the health server on
port 8080. Deployed to the `lore-floor` namespace on GKE via Terraform/Helm —
see [`infra/`](../../infra) and the root README.
