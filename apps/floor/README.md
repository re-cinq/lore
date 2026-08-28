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

The source is organized as the **3 event-bus layers** (ADR-015) plus the
unavoidable substrate. Every trigger flows through `pipeline.events` — owned by
the event-router (ADR-044): listeners report to the router over HTTP, the main
loop claims this Floor's delivery rows back from it + dispatches, the jobs do
the work. Special citizens that can't nest under a layer: `src/index.ts` (the
`dist/index.js` entry, may import anything); `kernel/` (substrate imported by
all, importing nothing above it); `delivery/` (the `dist/delivery/*` deploy
contract: job-runner, gen-catalog, the HTTP server); `composition/` (the wiring
root). Boundaries
enforced by [`src/domain-boundaries.test.ts`](./src/domain-boundaries.test.ts).

```
src/
  index.ts        the application entry — boots the loop + worker + health
  kernel/         shared substrate: db pool, config, agent-invocation, queues
                  (the lazy port singletons, incl. the cluster-agent + stations
                  + event-router HTTP clients)
  composition/    project-boot.ts — the wiring root (the one place impls are wired)
  delivery/       entry points (job-runner, gen-catalog) + http/ (webhook/CI
                  ingress, run-viz SSE, health — the deploy contract)

  listeners/      LAYER 1 — producers: report occurrences → the event-router
                  (cron-emitters, scheduler-emitter, ci-ingest/ci-tests maps,
                  agent-reconcile — the streaming k8s watch lives in
                  apps/event-router)
  main-loop/      LAYER 2 — the drain side: store (the HTTP claim/ack seam),
                  reaper, registry, event-names, types
                  + scheduling/ (the cron timer) + lease/ (branch coordination)
  jobs/           LAYER 3 — the tasks/jobs the events trigger:
                  github · kubernetes · cron · internal      (the event handlers)
                  task/ station/ assembly-run/ agent/ watcher/ merge/ review/
                  detect/ spec-trace/ memory/ context-jobs/ dark-factory/
```

Heavy batch jobs (under `jobs/context-jobs/`, `jobs/memory/`, …) still run as K8s
CronJob pods via `delivery/job-runner.ts` (carve-out, ADR-019); the light
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
npm run job -w @re-cinq/lore-floor -- <jobName>   # e.g. context_reindex, eval_runner
npm run jobs:all -w @re-cinq/lore-floor           # run every batch job in sequence
```

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile) (multi-stage; mirrors the
`apps/` + `libs/` workspace layout so the symlinked workspace deps resolve at
runtime). `CMD` runs `dist/index.js`, exposing the health server on
port 8080. Deployed to the `lore-floor` namespace on GKE via Terraform/Helm —
see [`infra/`](../../infra) and the root README.
