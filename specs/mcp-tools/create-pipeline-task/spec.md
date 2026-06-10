# Feature Specification: create_pipeline_task Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | create_pipeline_task   |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `create_pipeline_task` |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

Developers and PMs need a single MCP entry point to delegate work to the
Lore pipeline — generating specs, implementing from a spec, onboarding a
repo, drafting docs — without learning the task-type catalogue, the repo
remote, or whether the server is running locally (stdio proxy) or on GKE
(direct DB). The same call must respect per-repo trust gates so a repo
that has not earned `implementation` trust cannot be made to write code.

## Solution

A `create_pipeline_task` MCP tool that validates the description, resolves
the target repo from the git remote when omitted, maps the requested type
to a known task type, and inserts a `pipeline.tasks` row (recording the
`pending` event). In stdio mode it proxies to `POST /api/task`; in DB mode
it calls the trust-gated shared CRUD directly. `priority=immediate` flags
the row for GKE auto-pickup; `normal` leaves it in the backlog.

- IMPLEMENTED_BY: registration — [`pipeline-tools.ts#L25`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L25)
- IMPLEMENTED_BY: handler — [`pipeline.ts#L48`](../../../mcp-server/src/features/pipeline/pipeline.ts#L48)
- IMPLEMENTED_BY: shared CRUD — [`pipeline-tasks.ts#L35`](../../../shared/src/pipeline-tasks.ts#L35)

## Acceptance Criteria

1. An empty or whitespace-only description is rejected before any insert. (untested: validation guard is inline in the handler closure and not separately exported)
2. The target repo defaults to the git remote when `target_repo` is omitted; an explicit value wins. (untested: `detectCurrentRepo()` reads the ambient git remote — no deterministic seam without live repo state)
3. A task type outside the known catalogue falls back to `general`. (untested: fallback is inline in the handler closure and not separately exported)
4. A valid create inserts a `pipeline.tasks` row and records the `pending` transition event, returning the new task id and status. ([validated by `creates a linked task when the original is failed`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L95))

## Out of Scope

- Task execution (handled by the lore-agent service).
- Local claim/run (`claim_and_run_locally`, `run_task_locally`).
- The `sync_tasks` spec-task ingestion path.
