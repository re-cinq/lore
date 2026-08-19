# Feature Specification: Running Local Stations

| Field   | Value                  |
|---------|------------------------|
| Feature | Running Local Stations |
| Status  | Draft                  |
| Created | 2026-08-19             |
| Owner   | Platform Engineering   |

Running local stations lets a platform developer invoke any builtin assembly-line station type (validate, detect, gate, retrospective, github_action, comment-triage, ingest, issues) directly on their laptop via a single MCP tool call, without Docker or a Kubernetes cluster.

## Problem Statement

Builtin station types are dispatched as K8s pods by the ai-agent-subsystem's `exec` vendor. The only way to exercise one today is to push to a branch, trigger an assembly line on the cluster, and inspect the pod logs — a cycle that takes several minutes even for trivial changes. There is no local execution path and no MCP surface for station invocation.

This gap slows three common development tasks:

1. **Developing a new station** — every iteration requires a cluster deploy.
2. **Debugging a failing station** — no way to reproduce the exact input locally.
3. **Writing station tests** — the `runStation` function exists and is unit-tested, but the binary cannot be exercised end-to-end from a developer session without K8s.

## Solution

A new `lore_run_station_locally` MCP tool invokes the `lore-station` binary as a child process, forwarding a constructed `station_input` JSON and the required env vars, then returns the parsed terminal-line result.

The tool is registered only on the local (non-cluster) MCP server — the same trust boundary used by `lore_list_tests`, `lore_run_test`, and `lore_run_task_locally`.

### How It Works

```
Developer calls lore_run_station_locally({
  station_type: "validate",
  repo: "re-cinq/lore",      ← auto-detected from git remote if omitted
  branch: "feat/my-change",  ← auto-detected from HEAD if omitted
  params: { "validator": "all" }
})

MCP server:
  1. Validate params, fill defaults (repo/branch from git, random run id)
  2. Resolve lore-station binary:
       LORE_STATION_BIN env → <workspace>/apps/lore-station/dist/main.js → PATH
  3. Serialize station_input JSON via serializeStationInput()
  4. spawn(binary, [station_type, station_input_json], { env })
  5. Collect stdout, extract LORE_NODE_RESULT terminal line
  6. Return { outcome, extras, usage, log }
```

The station binary connects to the Lore API for data exactly as a K8s pod does (`LORE_API_URL` + `LORE_INGEST_TOKEN`). The tool does not clone the repo — `WORKSPACE_DIR` defaults to the developer's current checkout so stations that need a local tree (validate, detect) find one without a separate clone step.

### Binary Path Resolution

The binary is resolved in three steps, stopping at the first hit:

1. `LORE_STATION_BIN` environment variable (explicit override)
2. `<workspace root>/apps/lore-station/dist/main.js` — the workspace build (run `npm run build -w apps/lore-station` to produce it)
3. `lore-station` on `PATH`

If none resolves the tool returns an error naming all three candidates and the build command, before spawning anything.

### station_input Construction

The `station_input` JSON is produced by `serializeStationInput()` from `libs/shared/src/station-input.ts` — the same function the Floor uses — so the local binary receives an identical wire shape to what it sees in a K8s pod.

| Field | Local default |
|-------|---------------|
| `assembly_run_id` | random UUID (local runs never persist to `pipeline.assembly_runs`) |
| `node_id` | `station_type` argument |
| `node_type` | `station_type` argument |
| `repo` | auto-detected from `git remote get-url origin` |
| `branch` | auto-detected from `git rev-parse --abbrev-ref HEAD` |
| `task_id` | `null` |
| `params` | `params` argument, default `{}` |

Any field may be overridden by passing `station_input_overrides` to the tool.

## Functional Requirements

### FR-1: Trust boundary

- **FR-1.1** `lore_run_station_locally` MUST be registered in `local-runner-tools.local.ts` (the `.local.ts` module loaded only by the non-cluster MCP server). The cluster server MUST return `"Station execution runs only in a trusted sandbox — run locally."` with no process spawn (mirrors the execution-refusal pattern in `spec-trace-tools.ts`).

### FR-2: Binary resolution

- **FR-2.1** Binary path resolution MUST follow the three-step order: `LORE_STATION_BIN` env → `<workspace>/apps/lore-station/dist/main.js` → `lore-station` on `PATH`.
- **FR-2.2** Workspace root MUST be detected via `git rev-parse --show-toplevel` from `process.cwd()`, consistent with `getRepoRoot()` in `runner.local.ts`.
- **FR-2.3** When no binary is found the tool MUST return an error listing the three resolution candidates and the build command (`npm run build -w apps/lore-station`), without spawning a process.

### FR-3: Pre-spawn validation

- **FR-3.1** The tool MUST reject unknown station types before spawning, returning an error that lists the eight builtin types (validate, gate, retrospective, github_action, detect, comment-triage, ingest, issues).
- **FR-3.2** When `LORE_API_URL` or `LORE_INGEST_TOKEN` is absent from the environment the tool MUST return a setup error pointing to `.env.local.example`, before spawning.
- **FR-3.3** The assembled `StationInput` object MUST pass `StationInputSchema.parse()` (from `libs/shared/src/station-input.ts`) before it is serialized and spawned. A validation error is returned as a tool error, not as a process spawn.

### FR-4: Invocation

- **FR-4.1** The binary MUST be invoked as `<binary> <station_type> '<station_input_json>'` — the exact argv the station contract specifies (`specs/6-dark-factory/contracts/station-contract.md`).
- **FR-4.2** The child process MUST inherit `LORE_API_URL`, `LORE_INGEST_TOKEN`, and `WORKSPACE_DIR` from the MCP server's own environment. The `station_input_overrides.params` `extra_env` parameter (if present) adds or overrides env vars for the child only.
- **FR-4.3** `WORKSPACE_DIR` MUST default to the git root (`getRepoRoot()`) when not set in env, so stations that read the repo tree find a valid checkout without a separate clone.
- **FR-4.4** Execution is synchronous — the tool awaits the child to exit before returning. A `timeout_seconds` parameter (default 120, max 600) kills the child with `SIGTERM` on expiry and returns a timeout error; no zombie processes are left behind.

### FR-5: Result surface

- **FR-5.1** The tool MUST extract the final `LORE_NODE_RESULT` terminal line from stdout and parse it via the existing `parseNodeResult()` helper (`libs/shared/src/project/lib/node-outcome.ts` or equivalent). The parsed `NodeResult` (`outcome`, `extras`, optional `usage`) MUST be returned as the primary result.
- **FR-5.2** A non-zero exit code with no terminal line is an infrastructure failure; the tool MUST return the tail of stderr (up to 2 KB) as the error.
- **FR-5.3** The full stdout (log lines before the terminal line) MUST be returned alongside the parsed result so the developer can inspect event lines emitted by the station.
- **FR-5.4** `outcome` takes one of the three station outcomes (`success`, `changes_requested`, `failed`). A `failed` outcome is a normal station result (not a tool error) — the station ran to completion and decided the node failed.

### FR-6: Station-input defaults and overrides

- **FR-6.1** `repo` defaults to the current checkout's GitHub remote (`owner/repo`), detected by `detectRepo()` from `runner.local.ts`.
- **FR-6.2** `branch` defaults to `git rev-parse --abbrev-ref HEAD` from `getRepoRoot()`.
- **FR-6.3** `assembly_run_id` defaults to a random UUID generated by the MCP server (local runs are not persisted in `pipeline.assembly_runs`).
- **FR-6.4** The optional `station_input_overrides` parameter accepts any subset of `StationInput` fields and merges them over the defaults, allowing the developer to simulate the exact wire payload a K8s pod would receive.

### FR-7: Documentation

- **FR-7.1** The tool description MUST include an example `station_input_overrides` for the validate station so a developer can copy-paste without reading the full station contract.
- **FR-7.2** The tool description MUST note that `LORE_API_URL` and `LORE_INGEST_TOKEN` must be set in `.env.local`.

## File Changes

| File | Change |
|------|--------|
| `apps/mcp-server/src/mcp/tools/local-runner-tools.local.ts` | Add `lore_run_station_locally` tool |
| `apps/mcp-server/src/features/pipeline/runner.local.ts` | Add `runStationLocally(opts)` helper: binary resolution, spawn, result parsing |

No new dependencies are added to the MCP server. The `serializeStationInput` import is already in `@re-cinq/lore-shared`, which the MCP server already depends on. The `StationInputSchema` type travels over the same path.

## Security

- The tool runs the `lore-station` binary with the developer's own OS credentials, identical to running it by hand from a terminal.
- `LORE_INGEST_TOKEN` is forwarded to the child by reference (env var reference, not expanded into argv) so it does not appear in `ps` output.
- The tool imposes a hard `timeout_seconds` ceiling (600 s) to prevent runaway stations from keeping a process alive indefinitely.
- No secrets from the GKE cluster are accessed; the developer supplies their own `.env.local` credentials.

## Limitations

1. **Stations that require a K8s service account** (e.g., an ingest station that needs the dgraph endpoint) will fail unless `LORE_DGRAPH_HTTP` is also set in `.env.local`. The tool documents this per-station.
2. **The `assembly_run_id` is fake** — station runs triggered locally do not write `pipeline.station_runs` rows, so they do not appear in the run visualization UI.
3. **`github_action` stations** dispatch an actual GitHub Actions workflow run. Running one locally will trigger real CI; the developer must be aware.

## Acceptance Criteria

1. `lore_run_station_locally` appears in the local MCP server's tool list and is absent from the cluster server.
2. A validate station called with a valid repo and branch returns `outcome: "success"` or `outcome: "failed"` (a real station result, not a tool error).
3. An unknown station type is rejected before any process is spawned.
4. Missing `LORE_API_URL` returns a setup error naming `.env.local.example`, not a process spawn.
5. Binary not found on any of the three resolution paths returns the build command.
6. A station that exceeds `timeout_seconds` is killed and the tool returns a timeout error.
7. `repo` and `branch` are auto-detected from the current git checkout when not specified.
8. The `station_input_overrides` parameter overrides any auto-detected default, including `params`.
