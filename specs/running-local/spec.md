# Feature Specification: Running Local Stations

| Field   | Value                                                                    |
|---------|--------------------------------------------------------------------------|
| Feature | Running local stations — Docker station backend for local dev            |
| Status  | Draft                                                                    |
| Created | 2026-08-19                                                               |
| Owner   | Platform Engineering                                                     |
| ADR     | [`ADR-028`](../../adrs/ADR-028-station-runner-backends.md) (Docker adapter, originally described; Docker backend re-introduced for station nodes after Agent CR cutover) |

Implements the Docker station backend so that assembly-line station nodes (validate,
gate, detect, retrospective, comment-triage, ingest, issues) can run on a developer's
machine without cluster access — `docker run ghcr.io/re-cinq/lore-station <type>
'<station_input>'` instead of a K8s Agent CR. The synchronous-backend completion
circuit (`finalizeStationRun`) is already in place; this feature wires the adapter.

## Problem Statement

Every assembly-line station node runs as a K8s Agent CR, which the
ai-agent-subsystem controller turns into a pod. That is the correct cluster path.
On a developer's machine there is no Kubernetes, so any assembly line containing a
non-agent station node (`validate`, `gate`, `detect`, `retrospective`,
`comment-triage`, `ingest`, `issues`) is currently unrunnable locally.

ADR-028 described a Docker station backend and the `StationBackend` port it would
plug into. The ADR-031 cutover removed the original Docker adapter alongside
the legacy LoreTask path, but the port abstraction and the synchronous-completion
plumbing (`finalizeStationRun`, `StationCredentials`, `StationCompletion`) all
survived — they are the designed seam for this feature.

The `selectStationBackend` function already returns `"docker"` as the default for
off-cluster environments; the composition root just has no adapter to inject.

## Functional Requirements

- **FR1 — `DockerStationBackend`.** A new `DockerStationBackend` class in
  `apps/floor/src/adapters/docker-station.ts` implements `StationBackend`.
  `launch(spec)` runs the container synchronously:
  ```
  docker run --rm --network host \
    -e LORE_API_URL -e LORE_INGEST_TOKEN \
    -e GITHUB_TOKEN -e ANTHROPIC_API_KEY \
    [-v ~/.claude:/home/node/.claude:ro]  (when no API key)
    ghcr.io/re-cinq/lore-station \
    <spec.stationRef ?? spec.taskType> '<station_input_json>'
  ```
  It waits for the container to exit, collects stdout/stderr, parses the
  `LORE_NODE_RESULT` terminal line for `changedFiles` and `reviewResult`, and
  returns a `StationLaunchResult` with `completion` set — the synchronous
  contract. `buildDockerRunArgs(spec, creds)` is a **pure function** (no I/O)
  so it is unit-testable without running Docker.

- **FR2 — `StationCredentials` implementation.** A `DevStationCredentials` class
  (same file or `apps/floor/src/adapters/dev-station-credentials.ts`) implements
  the `StationCredentials` port (`libs/shared/src/project/agents/station-credentials.ts`):
  - `gitToken()` — mints a short-lived GitHub App installation token via
    `GitHubPlatform.getInstallationToken(targetRepo)`. Secrets pass by env var
    reference (`-e GITHUB_TOKEN`), never in argv.
  - `llm()` — returns `{ apiKey }` when `ANTHROPIC_API_KEY` is set; otherwise
    returns `{ mounts: [{ hostPath: "~/.claude", containerPath: "/home/node/.claude", readOnly: true }] }`
    so the in-container `claude` CLI finds its auth. Enforces that at least one
    of the two is present and throws a clear error before spawning Docker.

- **FR3 — Composition root wiring.** `apps/floor/src/composition/project-boot.ts`
  `stationBackend()` inspects `selectStationBackend(env)`:
  - `"docker"` → inject `DockerStationBackend(new DevStationCredentials(...))`
  - `"k8s"` → existing `AgentCrStationBackend` (unchanged)
  - `"inprocess"` → the escape hatch; worker.ts handles feature-finalize
    in-process as today

- **FR4 — `dev-local.sh` env gate.** `scripts/dev-local.sh` sets
  `LORE_STATION_BACKEND=docker` as belt-and-suspenders alongside the
  `KUBERNETES_SERVICE_HOST` auto-detect. If `LORE_STATION_IMAGE` is unset it
  defaults to `ghcr.io/re-cinq/lore-station:latest`. The script builds the
  image locally (`docker build -f apps/lore-station/Dockerfile .`) when it is
  not present in the local daemon, so the first run is self-sufficient. A
  missing `GITHUB_APP_*` or LLM credential surfaces as a human-readable error
  via the `DevStationCredentials` enforce before any container starts.

- **FR5 — `isActive` probe.** `DockerStationBackend.isActive(taskId)` calls
  `docker inspect loretask-<first8>` and returns `true` when the container
  exists and is running, `false` when it is absent or exited, and `true` (conservative
  fallback) when `docker inspect` fails — matching the station-port contract so
  the planning reaper's liveness bound behaves correctly locally.

- **FR6 — `station_input` serialisation.** The station type and serialised
  `station_input` are passed as two positional arguments, matching the
  `lore-station <type> '<json>'` argv contract in `apps/lore-station/src/main.ts`.
  Credentials never appear as positional args or in the image name.

- **FR7 — image resolution.** The image used by `DockerStationBackend` is
  `LORE_STATION_IMAGE ?? "ghcr.io/re-cinq/lore-station:latest"`. This allows a
  developer to pin to a specific tag or test a local build without changing code.

## Non-goals

- Agent (LLM claude-code) station nodes: the Agent CR path stays K8s-only even
  locally; this feature only covers `exec`-mode station types that run
  `lore-station <type> '<input>'`.
- A local K8s cluster (minikube/kind) — the Docker backend is the deliberate
  lightweight alternative.
- The `inprocess` escape hatch — it remains for devs without Docker or GitHub
  App credentials; `LORE_STATION_BACKEND=inprocess` is never the default.
- Running the ai-agent-subsystem controller locally — Agent CRs still require
  a cluster.

## Acceptance Criteria

1. `buildDockerRunArgs(spec, creds)` is a pure function that produces a correct
   `docker run` argv with credentials supplied by env var reference (never
   inline), verified by a unit test without running Docker.
2. A validate station node in a local assembly-line run completes end-to-end:
   the `docker run` exits 0, `finalizeStationRun` marks the task `completed`.
3. A non-zero container exit → `finalizeStationRun` marks the task `failed` with
   the log tail in `failure_reason` and the exit code in the audit event.
4. Zero exit, zero changed files → task `completed` with no PR opened.
5. `docker ps` output for a running station container never shows a credential
   value in the command column.
6. `DevStationCredentials.llm()` throws a clear human-readable error when
   neither `ANTHROPIC_API_KEY` nor a readable `~/.claude` directory is present.
7. `LORE_STATION_BACKEND=inprocess` still routes `feature-finalize` to the
   in-process handler unchanged.
8. `LORE_STATION_IMAGE=ghcr.io/re-cinq/lore-station:edge` is respected by
   `DockerStationBackend`, confirmed by inspection of `buildDockerRunArgs`
   output.
