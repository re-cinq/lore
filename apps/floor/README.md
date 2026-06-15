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
  API, runs them via direct Anthropic API calls (simple) or by creating LoreTask
  CRs that spawn ephemeral claude-runner Job pods (implementation/review).
- **Scheduling** — an in-process scheduler for sub-minute, hot-path, and
  webhook-coupled jobs; batch jobs run as standalone CronJob pods.
- **LoreTask controller** — watches LoreTask CRs and creates Job pods.
- **Dark Factory supervisor** — drives the branch-as-state workflow inside Job
  pods, emitting `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` commit trailers so
  a run can resume after pod death (ADR-016).
- **Auto-merge, escalation, leases, audit** — the operational machinery around
  autonomous task runs.

## Layout

The source is layered (delivery → application → adapters → data → ports):

```
src/
  delivery/          entrypoints
    index.ts             main service: in-process scheduler + worker + health (:8080)
    job-runner.ts        batch CronJob pod entry — `node dist/delivery/job-runner.js <jobName>`
    loretask-controller-main.ts   LoreTask CR controller entry
    runner-cli.ts        Job-pod CLI entry for the Dark Factory workflow supervisor
    health.ts            health/status HTTP server
  application/        orchestration & business logic
    orchestrator.ts      task orchestration
    task-processing/     the worker (claim, run, recover stale tasks)
    scheduling/          cron scheduler
    jobs/cron/           batch jobs (reindex, gap-detect, spec-drift, memory lifecycle, ...)
    jobs/scheduled/      in-process jobs (loretask-watcher, review-reactor, merge-check, ...)
    loretask-controller/ controller reconcile loop
    spec-trace/          spec→test trace ingestion
  adapters/          outbound integrations (github, k8s, anthropic-cost, dark-factory,
                     audit, episode-writer, escalation, lease-backend, pr-policy, approval, ...)
  data/              db pool, config loader, repositories/
  ports/             platform.ts (CodePlatform port)
```

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
