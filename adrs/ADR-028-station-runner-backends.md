---
adr_number: 28
title: "Station runner backends: one port, K8s (cluster) + Docker (local)"
status: shipped
date: 2026-06-17
domains: [agent, pipeline, infra]
---

# ADR-028: Station runner backends

This ADR introduces one StationBackend port with two adapters — a Kubernetes Job pod on the cluster and a plain docker run locally — chosen by an explicit env var, so Station tasks run in both environments without the local dev path diverging.

> **Mechanism update ([ADR-031](./ADR-031-agent-station-crds.md)).** The `StationBackend`
> port this ADR introduced still holds — but the **LoreTask** and **Docker** backends
> described below have been **removed**. The ai-agent-subsystem (`AgentBackend` +
> `AssemblyLineStationBackend`) is now the sole implementation; the `RoutingStationBackend`
> cutover router and the per-repo backend opt-in are gone. The port abstraction is what
> made that swap a drop-in.

## Context

ADR-027 declared feature planning/finalize run as **Stations** — the existing
cluster path creates a LoreTask CR that the loretask-controller turns into a Job
pod. That path is K8s-only: the adapter calls `kc.loadFromCluster()`
([k8s-loretask.ts](../apps/floor/src/adapters/k8s-loretask.ts)), which reads the
in-cluster service account. On **local dev there is no Kubernetes**, so the call
produced an empty API-server URL and every Station task died with `Invalid URL`,
with no UI feedback. We patched it with an in-process stopgap handler — but that
diverges from the cluster behavior and isn't a real abstraction.

A "Station" is just "run one task in the claude-runner container." Locally that
should be a plain `docker run` of the same image; on the cluster it stays a Job
pod. Prod must keep working unchanged on its K8s cluster.

## Decision

**One `StationBackend` port, two adapters, chosen by an explicit env var.**

- **Port** ([station-port.ts](../libs/shared/src/project/agents/station-port.ts)):
  `StationBackend.launch(spec) → StationLaunchResult`. Key asymmetry —
  **synchronous** backends (Docker) wait on the run and return a `completion`;
  **asynchronous** backends (K8s) omit it and the loretask-watcher resolves
  completion from the CR status later. `AgentRunner`'s `cluster` mode calls the
  injected backend and surfaces `completion` on the run result.
- **Selection** — `selectStationBackend(env)`: explicit `LORE_STATION_BACKEND`
  (`k8s` | `docker` | `inprocess`) wins; else default by context —
  `KUBERNETES_SERVICE_HOST` present (in-cluster) → `k8s`, else → `docker`. The
  composition root ([project-boot.ts](../apps/floor/src/application/project-boot.ts))
  injects the chosen backend.
- **K8s adapter** — unchanged behavior; `K8sLoreTaskClient` now also `implements
  StationBackend` (launch → existing `createLoreTask`). **Prod is byte-identical.**
- **Docker adapter** ([docker-station.ts](../apps/floor/src/adapters/docker-station.ts)):
  `docker run --network host` the same image, env from the shared
  [`stationPlainEnv`](../libs/shared/src/project/agents/station-env.ts) (so the two
  backends can't drift), `GITHUB_TOKEN` minted in-process via
  `GitHubPlatform.getInstallationToken()`, LLM cred via `ANTHROPIC_API_KEY` or a
  mounted `~/.claude`. Secrets pass by-reference (`-e NAME`) so they stay out of
  `argv`/`ps`. `buildDockerRunArgs` is a pure, unit-tested function.
- **Completion without a watcher (local):** `finalizeStationRun`
  ([finalize-station-run.ts](../apps/floor/src/application/task-processing/finalize-station-run.ts))
  runs inline off the container exit — opens the PR for the pushed branch / flips
  a finalized feature to `pr-open`. feature-planning self-POSTs its `GapResult`
  (CHANGES=0), so it needs no finalize step. The K8s path keeps using the watcher.
- **Everything routes through the Station.** Planning/finalize go through the
  Station backend (Docker locally, K8s on the cluster). `LORE_STATION_BACKEND=inprocess`
  is an explicit, never-defaulted escape hatch that keeps the lightweight
  in-process planning/finalize handlers for a dev without Docker/creds.

## Consequences

- Prod unaffected: in-cluster default already resolves to `k8s`; `floor-helm`
  sets it explicitly as belt-and-suspenders. `dev-local.sh` sets `docker` and
  builds the runner image if missing.
- Local Station runs need `GITHUB_APP_*` + an LLM credential in `.env.local`
  (the container clones/pushes + calls the model). Documented in
  `.env.local.example`; the Docker adapter `enforce`s a clear error otherwise.
- Routing planning through Docker is heavier than in-process (clone + container
  per round). Accepted for parity; `inprocess` remains for speed. Station
  failures stay visible + retryable in the wizard (ADR-027).
- Supersedes ADR-027's "planning runs in-process" note — that is now the
  `inprocess` fallback, not the default.
