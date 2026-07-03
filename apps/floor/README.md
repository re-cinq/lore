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

The source is organized as the **3 event-bus layers** (ADR-015) plus the
unavoidable substrate. Every trigger flows through `pipeline.events`: listeners
write rows, the main loop drains + dispatches, the jobs do the work. Special
citizens that can't nest under a layer: `src/index.ts` (the `dist/index.js`
entry, may import anything); `kernel/` (substrate imported by all, importing
nothing above it); `delivery/` (the `dist/delivery/*` deploy contract:
job-runner, gen-catalog, health); `composition/` (the wiring root). Boundaries
enforced by [`src/domain-boundaries.test.ts`](./src/domain-boundaries.test.ts).

```
src/
  index.ts        the application entry — boots the loop + worker + health
  kernel/         shared substrate: db pool, config, agent-invocation, repositories
  composition/    project-boot.ts — the wiring root (the one place impls are wired)
  delivery/       entry points (job-runner, gen-catalog) + health (deploy contract)

  listeners/      LAYER 1 — producers: capture occurrences → pipeline.events
                  (github-webhook, k8s-watch, scheduler-emitter + map/sig pures)
  main-loop/      LAYER 2 — the drain loop + internal processes: store, loop,
                  reaper, retry, registry, event-names, dedupe, types
                  + scheduling/ (the cron timer) + lease/ (branch coordination)
  jobs/           LAYER 3 — the tasks/jobs the events trigger:
                  github · kubernetes · cron · internal      (the event handlers)
                  task/ station/ assembly-line/ agent/ watcher/ merge/ review/
                  spec-trace/ memory/ cost/ context-jobs/ dark-factory/ platform/
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
