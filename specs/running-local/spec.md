# Feature Specification: Running local stations

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | Running local stations                         |
| Status  | Draft                                          |
| Created | 2026-08-19                                     |
| Owner   | Platform Engineering                           |
| ADR     | [`ADR-028`](../../adrs/ADR-028-station-runner-backends.md) (Docker backend; the port this spec re-activates for assembly line nodes) |

Enables every assembly line station node type (detect, gate, validate, ingest, comment-triage) to run locally via `docker run ghcr.io/re-cinq/lore-station` instead of K8s Agent CRs, so `npm start` can exercise the full Floor pipeline without minikube.

## Problem Statement

The Floor's assembly line currently dispatches every non-agent node as a K8s Agent CR (`AgentCrStationBackend` + `KubeAgentApi`). On a local development machine without Kubernetes, the Floor boots with `LORE_STATION_BACKEND=inprocess` — an escape hatch that only covers `feature-planning` and `feature-finalize` (which self-POST their results and commit respectively). All other node types — detect, gate, validate, ingest, comment-triage — silently fail or cannot be triggered at all because they require a live kube API server.

This makes it impossible to:
- Run a detection sweep locally (`gap_detection`, `spec_drift`, `spec_coverage_validate`)
- Test a custom assembly line definition end-to-end without deploying to GKE
- Iterate on station node logic (e.g. `lore-station detect`) without a full cluster

ADR-028 defined the `StationBackend` port and described a Docker adapter for exactly this purpose. That adapter was later superseded by the ai-agent-subsystem (ADR-031), but the port itself survived. This spec reinstates the Docker execution path for the `exec`-type assembly line nodes that the lore-station image handles.

## Functional Requirements

- **FR1 — Docker station backend for exec-type nodes.** A new `DockerAssemblyStationBackend` implements `StationBackend.launch(spec)` for exec-type assembly line nodes. It runs:

  ```
  docker run --rm --network host \
    -e LORE_API_URL -e LORE_INGEST_TOKEN -e ANTHROPIC_API_KEY \
    ghcr.io/re-cinq/lore-station <node_type> '<station_input_json>'
  ```

  Secrets pass by reference (`-e NAME`, never `-e NAME=VALUE`) so they stay out of `argv`/`ps` and match the K8s path's env posture. The node type and `station_input` come from the assembly line node spec passed through `LoreTaskSpec.stationInput`. The container runs synchronously; the function awaits its exit and returns a `StationCompletion` (exit code, stdout/stderr, changed-files count from `LORE_CHANGED_FILES` env the station exports).

- **FR2 — Inline node completion (no K8s watch needed).** Because `docker run` is synchronous, completion does not go through the `kubernetes.agent_node.*` event path. Instead, `DockerAssemblyStationBackend.launch()` parses `LORE_NODE_RESULT` from stdout (reusing `stationNodeOutcome` from `@re-cinq/lore-assembly-lines`), calls `finishNodeTerminal` directly, and fires `advanceLine` inline. The assembly line walk advances in the same Floor process that launched the container, with no K8s watch dependency.

- **FR3 — `project-boot.ts` respects `selectStationBackend`.** The `stationBackend()` composition function in `apps/floor/src/composition/project-boot.ts` calls `selectStationBackend(process.env)` and branches:
  - `k8s` (default in-cluster) → existing `AgentCrStationBackend` (K8s Agent CRs, unchanged)
  - `docker` (default off-cluster when Docker socket reachable) → `DockerAssemblyStationBackend` for exec-type nodes; single-agent tasks (onboard, review) fall through to the in-process `runClaudeCli` path
  - `inprocess` → existing escape hatch (feature-planning/finalize only)

  The env-var selection is already implemented in `selectStationBackend` (`libs/shared/src/project/agents/station-port.ts`); `project-boot.ts` has not yet called it. This FR wires the call.

- **FR4 — `dev-local.sh` switches default to `docker`.** `scripts/dev-local.sh` changes its `LORE_STATION_BACKEND` default from `inprocess` to `docker` when the Docker socket is reachable (checked via `docker info`). When Docker is absent, it falls back to `inprocess` with a warning. The minikube bootstrap block (`if [ "$LORE_STATION_BACKEND" = "k8s" ]`) is unchanged; developers who want GKE-identical behavior still set `LORE_STATION_BACKEND=k8s` explicitly.

- **FR5 — Secret injection parity with K8s.** The Docker container receives the same credential set as a K8s station pod:
  - `LORE_API_URL` — the in-process Floor's own HTTP bind address (e.g. `http://localhost:8080`) so the container can POST its result and read context
  - `LORE_INGEST_TOKEN` — write-scope bearer token (same env var as K8s pods)
  - `ANTHROPIC_API_KEY` or a bind-mounted `$HOME/.claude` — LLM credential; `ANTHROPIC_API_KEY` wins when both are set
  - `GITHUB_TOKEN` — minted in-process via `GitHubPlatform.getInstallationToken()` (same as the original ADR-028 Docker adapter)

  No additional secrets are needed: station pods have no Postgres/App-server credentials (D7 in the ingest-station spec). Secrets that are unset in the developer's environment produce a clear `enforce` error before the container launches.

- **FR6 — Assembly line overlap guard works across Docker runs.** Docker station runs participate in the existing branch-keyed lease overlap guard (FR1.6 of the dark-factory spec). The `assembly_runs` lease branch key (`detect/<definition>/<repo>`) is passed through to `DockerAssemblyStationBackend.launch` via `spec.branch`; the backend does not acquire a separate lock — the Floor-side `assemblyRuns().start()` call (already made by `AssemblyLineStationBackend.launch` before this feature) holds the row. A second start attempt while the first run's row is `running` hits the existing UNIQUE constraint guard and returns `launched: false` (same behavior as K8s).

- **FR7 — Detection sweeps work locally.** With the Docker backend wired, a developer can trigger a detection run:

  ```typescript
  await insertEvent(taskId, "cron.gap_detection.tick", {});
  ```

  The fan-out handler starts one assembly line per repo; each `detect` node dispatches via `DockerAssemblyStationBackend`, which runs `lore-station detect '<station_input>'` locally. The detection result (gap issues, spec-drift PRs, etc.) flows through the same `LORE_NODE_RESULT` / `advanceLine` path as on the cluster.

- **FR8 — `buildDockerRunArgs` is a pure, unit-tested function.** The Docker argument builder — image name, node type, station input JSON, environment variables, network flags — lives in a standalone pure function `buildDockerRunArgs(spec, env)` that accepts a `LoreTaskSpec` and a credential env map and returns a `string[]`. This makes the Docker argument construction testable without spawning a real container, matching the existing test pattern for `stationPlainEnv` in ADR-028.

## Non-goals

- Running **agent-type** (Claude Code) assembly line nodes locally via Docker — those already work via `runClaudeCli` in the `local` mode of `AgentRunner`. This spec only covers `exec`-type (lore-station) nodes.
- Running **feature-planning / feature-finalize** via Docker — these are handled by the `inprocess` escape hatch and do not need a Docker container locally.
- Live streaming of Docker container logs into the run-viz SSE stream — the local container writes `LORE_NODE_RESULT` to stdout and the Floor reads it on exit; real-time streaming (ADR-037) is a follow-up.
- Networking across multiple docker-compose services (dgraph egress, etc.) — local detect stations that need dgraph (`def-detect`, `def-ingest`) require `LORE_DGRAPH_HTTP` to be set pointing at the local dgraph container; the Floor does not provision this automatically.
- Automatic image pull — if the `lore-station` image is not already present locally, `docker run --rm` will pull it on first use. No pre-pull step is added to `npm start`.

## Acceptance Criteria

1. `LORE_STATION_BACKEND=docker npm start` boots the Floor without errors and the `stationBackend()` function returns a `DockerAssemblyStationBackend`-backed station.
2. Inserting a `cron.gap_detection.tick` event while running locally triggers one `detect` node per repo; each dispatches a `docker run ghcr.io/re-cinq/lore-station detect` container and the assembly line advances inline to `done` or `failed`.
3. The `buildDockerRunArgs` unit test verifies that secrets appear as `-e NAME` (no value in argv), the station type and JSON input are correct, and `--network host` is present.
4. When `LORE_STATION_BACKEND=docker` and `ANTHROPIC_API_KEY` is unset, the Floor logs a clear error before attempting to launch a container rather than crashing mid-run.
5. `dev-local.sh` defaults to `docker` when `docker info` succeeds, and falls back to `inprocess` (with a printed warning) when Docker is unreachable. Existing `LORE_STATION_BACKEND=k8s` explicit override continues to work unchanged.
6. The K8s `AgentCrStationBackend` path is byte-identical to today when `LORE_STATION_BACKEND=k8s` or when the Floor is running in-cluster.
