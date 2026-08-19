# Feature Specification: Running Local Stations

| Field     | Value                                                                        |
|-----------|------------------------------------------------------------------------------|
| Feature   | Running Local Stations                                                       |
| Status    | Draft                                                                        |
| Created   | 2026-08-19                                                                   |
| Owner     | Platform Engineering                                                         |
| ADR       | [ADR-028](../../adrs/ADR-028-station-runner-backends.md)                     |
| Builds on | [local-task-runner](../local-task-runner/spec.md), [ingest-station](../ingest-station/spec.md) |

Running Local Stations enables the developer-side local task runner to execute
non-agent assembly-line station types (`validate`, `gate`, `retrospective`,
`detect`, `comment-triage`, `ingest`, `github_action`, `issues`) in-process on
the local machine, so that assembly lines containing those nodes complete
end-to-end without a GKE cluster.

**Status tripwire — read before adding a test link to this spec.** `lore/require-status-matches-coverage` is an ERROR and derives the required status from this document's own links: no link entitles it to `Draft`, one or more to `In Progress`, all of them to `Shipped`. The moment any implementing issue adds a single `([validated by …])` link below without flipping the `| Status |` row above, `eslint .` goes red repo-wide for everyone, not just for that PR. Flip the row in the same commit that adds the first link.

## Problem Statement

The local task runner (`lore_claim_and_run_locally`, `lore_run_task_locally`)
can spawn Claude Code worktrees for `agent`-type assembly-line nodes. But every
other node type — `validate`, `gate`, `retrospective`, `detect`,
`comment-triage`, `ingest`, `github_action`, `issues` — is dispatched by the
Floor as a `lore-station <type>` Kubernetes Job pod. Locally there is no
Kubernetes, so any assembly line that contains a non-agent node cannot complete:
the walk either stalls waiting for a station CR that never arrives or advances
past the node without running it.

In practice, every production assembly line has at least one non-agent node:
`implementation` has `validate` + `retrospective`; `feature-finalize` has
`retrospective`; the detection lines are almost entirely `detect` nodes. A
developer who claims one of these tasks locally gets partial execution at best.

The `lore-station` image's runner logic (`apps/lore-station/src/main.ts`) is
already factored into importable station-runner functions (`runValidateStation`,
`runGateStation`, etc.) that depend only on HTTP access to the Lore API and a
local filesystem path — no cluster-level credentials. The same code that runs in
the pod can run in-process on the local machine.

## Goals

- Any assembly line that would run on GKE runs end-to-end locally for a
  developer with `LORE_API_URL` + `LORE_INGEST_TOKEN` set.
- Non-agent nodes execute in-process using the same shared station-runner
  functions the `lore-station` image uses — zero divergence in business logic.
- The local walk advances deterministically: agent nodes run as Claude Code
  worktree processes, station nodes run in-process, and the walk moves to the
  next node only after the current one emits its outcome.
- Station types that genuinely require GKE-only infrastructure (`ingest` →
  `LORE_DGRAPH_HTTP`; `github_action` → cluster token provisioning) degrade
  gracefully with a clear log message and a `skipped` outcome, rather than
  failing the whole line.

## Non-Goals

- Running the Floor's event-driven assembly-line walk locally. The local runner
  owns its own synchronous walk; it does not participate in the
  `pipeline.events` bus or write `pipeline.station_runs` rows back to the
  remote database.
- Replacing the K8s station backend on the cluster. The `AgentCrStationBackend`
  and the pod-based path are unchanged in production.
- Human station support. Human stations dispatch nothing and wait for a person to
  take action; the local runner has no mechanism to pause mid-walk for a human
  handoff.

## Design

### Local station runner

A new `LocalStationRunner` module (inside `apps/mcp-server/src/features/pipeline/`) accepts a station type, a `StationInput` JSON payload, and a workspace directory, then imports and calls the corresponding runner function from `@re-cinq/lore-station` (the shared station-runner package). It mirrors the logic of `apps/lore-station/src/main.ts:runStation` but runs synchronously in the same Node.js process rather than in a child container.

```
localRunStation(type, stationInput, workspaceDir)
  → { outcome, extras, output }
```

The function resolves the runner by type (`validate` → `runValidateStation`,
`retrospective` → `runRetrospectiveStation`, …), constructs a `StationEnv` from
the local environment (workspace dir, `LORE_API_URL`, `LORE_INGEST_TOKEN`,
`ANTHROPIC_API_KEY`), and returns a `NodeResult`-compatible result.

### Walk integration in the local runner

The local runner's assembly-line walk (`runner.local.ts`, or a new
`local-assembly-walk.ts`) currently advances only through agent nodes. After
this feature, the walk branches on node type:

- **`agent` node** — spawn a Claude Code worktree process exactly as today.
  Wait for the process to exit and read the `LORE_NODE_RESULT` line from its
  output to determine outcome.
- **`human` station** — log a warning and record outcome `skipped`; the walk
  continues on the `always` edge so the line does not stall.
- **Any other type** — call `localRunStation(type, input, workspaceDir)` and
  use its returned outcome to select the next edge.

The `station_input` JSON passed to `localRunStation` is assembled locally
from the run's task record, the current branch name, and any `args` the line
carries — the same fields the Floor assembles before dispatching a K8s pod.

### Station type support matrix

| Type | Local support | Prerequisite / degradation |
|------|--------------|---------------------------|
| `validate` | Full | `GITHUB_TOKEN` for file checkout; validates changed files in the worktree |
| `gate` | Full | Reads `args.gate_result` from the line; no external calls |
| `retrospective` | Full | `LORE_API_URL` + `LORE_INGEST_TOKEN` to write the episode; skipped gracefully when API is unreachable |
| `detect` | Full | Reads files from the local worktree clone; `LORE_API_URL` to POST detections |
| `comment-triage` | Full | `GITHUB_TOKEN` to read PR comments; `LORE_API_URL` for episode write |
| `issues` | Full | `GITHUB_TOKEN` to open/close issues |
| `github_action` | Skipped | Requires cluster-level token provisioning and the GHA trigger endpoint; logs a clear message and records `skipped` |
| `ingest` | Conditional | Runs when `LORE_DGRAPH_HTTP` is set (a local DGraph instance); skipped with a log message when unset, since the label-scoped egress that gives pods DGraph access is GKE-only |

## Functional Requirements

### FR1 — Local station executor

- **FR1.1** `localRunStation(type, stationInput, workspaceDir)` accepts a
  builtin station type string, a parsed `StationInput`, and a workspace
  directory path; returns a `NodeResult` (`{ outcome, message, extras }`). It
  MUST NOT throw — all errors are returned as a `{ outcome: "failed", message
  }` result.
- **FR1.2** The function calls the corresponding typed runner from
  `apps/lore-station/src/stations/` — the same function the pod calls. The
  business logic is single-sourced; no parallel implementation exists in the
  local runner.
- **FR1.3** An unknown station type returns `{ outcome: "failed", message:
  "unknown station type <type>" }` and logs a warning, rather than throwing.
- **FR1.4** The `StationEnv` passed to each runner is constructed from the
  local process environment: `workspaceDir` from the call argument; `apiUrl`
  from `LORE_API_URL`; `token` from `LORE_INGEST_TOKEN`; `llm` from the
  shared `Llm` factory using `ANTHROPIC_API_KEY`.

### FR2 — Walk integration

- **FR2.1** The local runner's assembly-line walk identifies a node's type from
  the loaded assembly-line definition and routes execution to the correct path:
  `agent` → worktree Claude Code process; non-agent → `localRunStation`.
- **FR2.2** The walk waits for the current node's outcome before advancing. For
  station nodes this is synchronous (the in-process call returns). For agent
  nodes this is asynchronous (the process emits `LORE_NODE_RESULT` or exits).
- **FR2.3** Outcome-based edge selection uses the same `nextTransition` pure
  function as the Floor's event-driven walk, applied against an in-memory
  `NodeVisit[]` accumulator rather than `pipeline.station_runs` rows.
- **FR2.4** A human-station node logs `"human station <id> — skipping locally"`
  and records outcome `skipped`, allowing the walk to continue on the `always`
  edge rather than stalling.

### FR3 — Graceful degradation for GKE-only station types

- **FR3.1** When `localRunStation` is called with type `github_action`, it
  returns `{ outcome: "skipped", message: "github_action requires cluster token
  provisioning — skipped locally" }` without attempting any execution.
- **FR3.2** When type is `ingest` and `LORE_DGRAPH_HTTP` is unset, the function
  returns `{ outcome: "skipped", message: "ingest station requires
  LORE_DGRAPH_HTTP — skipped locally" }`.
- **FR3.3** A `skipped` outcome advances the walk on the `always` edge when one
  exists, or on `success` when no `always` edge is declared. Lines that cannot
  tolerate a skipped node should declare an explicit `on: failed` edge; the
  local runner does not convert `skipped` to `failed` unilaterally.

### FR4 — Station input construction

- **FR4.1** The `station_input` JSON constructed by the local runner for each
  station node MUST include at minimum: `task_id`, `repo`, `branch`,
  `node_id`, `assembly_line_id` (a local synthetic UUID stable for the run),
  `task_type`, and any `args` the line carries at that point (e.g.
  `args.spec_plan` written by a preceding agent node via `LORE_NODE_RESULT`).
- **FR4.2** The local runner reads `LORE_NODE_RESULT` lines from the preceding
  agent node's stdout and merges any `extras` key it finds into the `args`
  object, so station nodes that depend on agent output (e.g. `validate` reading
  `changed_files`) receive it.

### FR5 — Observability

- **FR5.1** Each local station invocation emits a progress log line before
  execution: `[local-station] running <type> for node <id>`.
- **FR5.2** On completion, a summary line reports the outcome:
  `[local-station] <type> → <outcome>` (plus `message` when non-empty).
- **FR5.3** The full station output (stdout/stderr equivalent) is appended to
  the task's log file alongside the Claude Code output, so `lore_get_task_logs`
  (or the task log file) contains a unified run transcript.

## Integration Points

- **`apps/lore-station/src/stations/`** — imported directly; no subprocess
  involved. The `@re-cinq/lore-station` package boundary makes this a clean
  internal import from `apps/mcp-server` (acceptable as a monorepo intra-app
  dependency; production builds keep the two images separate).
- **`libs/assembly-lines/src/transition.ts`** — `nextTransition` is already a
  pure, importable function; the local walk calls it with its in-memory
  `NodeVisit[]` rather than queried DB rows.
- **`apps/mcp-server/src/features/pipeline/runner.local.ts`** — the walk
  extension lives here (or an adjacent `local-assembly-walk.ts`) and is called
  by `spawnLocalTask` / `claimAndRunLocally` when the task type has an
  assembly-line definition.
- **`libs/assembly-lines/src/loader.ts`** — the local runner loads the
  assembly-line YAML definition via `loadBuiltinAssemblyLines()` (already
  importable from the shared package) to determine node types.

## Security

Station runners receive `GITHUB_TOKEN` and `LORE_INGEST_TOKEN` from the local
environment, the same way they do in the Docker-station path (ADR-028:
"secrets pass by-reference so they stay out of `argv`/`ps`"). No secret is
written to the task log file (`redactSecrets` wraps station output before
appending to the log, matching the existing Claude Code output redaction).

## Open Questions

1. **`@re-cinq/lore-station` as a shared package vs. intra-app import** — the
   `apps/lore-station` app is not currently a published package; importing it
   from `apps/mcp-server` requires either lifting the runners into
   `libs/shared` or treating the import as an intra-monorepo dev-dependency.
   Preferred path: extract the station runner functions into a new
   `libs/station-runners` library so the dependency is explicit and the
   `lore-station` image remains thin.
2. **`args` propagation between nodes** — the Floor merges `LORE_NODE_RESULT`
   `extras` into `pipeline.assembly_runs.args` via the DB; the local walk must
   do the same in memory. The exact schema for which `extras` keys become
   `args` fields should be specified before implementation.
