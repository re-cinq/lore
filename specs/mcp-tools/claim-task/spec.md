# Feature Specification: lore_claim_task MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_claim_task MCP Tool                    |
| Status  | In Progress                            |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `lore_claim_task`                           |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

`lore_claim_task` atomically flips one pending spec-task to `running` under a row lock so exactly one polling agent wins ownership and everyone else is told the task is already taken.

## Problem Statement

Multiple agents may poll the same repo's ready spec-tasks at once. Without an
atomic claim, two agents could both start the same task and open duplicate PRs.
`lore_claim_task` flips one `pending` task to `running` under a row lock so exactly
one caller wins; everyone else is told the task is already taken.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L292)).

- **name**: `lore_claim_task`
- **description** (verbatim):

```text
Atomically locks one 'pending' spec-task (flips it to 'running') so exactly one agent owns it. (DB-only) Use right before starting a task surfaced by lore_ready_tasks. Instead: lore_complete_task to mark it done afterward; lore_skip_task to dismiss a local notification without a server claim.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | Task id to claim. |
| `agent_id` | string | no | — | Claiming agent identifier. Auto-resolved when omitted. |

## Behavior

1. Resolve `agent_id || resolveAgentId()` (env / `~/.lore/agent-id` / generated)
   client-side: the claiming identity lives on the caller's machine.
2. `POST /api/spec-tasks/claim` with `{task_id, agent_id}` via `proxyToApi`. The
   MCP adapter holds no pool (ADR-032), so the atomic claim runs in lore-api
   ([`POST /api/spec-tasks/claim`](../../api-routes/spec-tasks/spec.md)).
3. The route delegates to `claimTask(pool, task_id, agent_id)`
   ([handler](../../../libs/server-core/src/features/pipeline/tasks.ts#L29)). It:
   1. `pool.connect()` → `BEGIN`.
   2. `SELECT id FROM pipeline.tasks WHERE id = $1 AND status = 'pending' FOR UPDATE SKIP LOCKED`.
   3. If no row → `ROLLBACK`, release, return `false`.
   4. Else `UPDATE pipeline.tasks SET status = 'running', agent_id = $2, updated_at = now() WHERE id = $1`.
   5. Best-effort `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1,'pending','running',$2)` with metadata `{ agent_id, claimed_by: 'lore_claim_task' }`; a failure here is swallowed and does not block the claim.
   6. `COMMIT`, release client, return `true`. Any thrown error → `ROLLBACK` + release + rethrow.
4. If the response reports `claimed: false`, return
   `"Could not claim task {task_id}. It may already be claimed or does not exist."`.
5. Otherwise return `"Task {task_id} claimed by {resolvedAgent}."`.
6. **Failure** — `not_configured` → the not-configured text; `denied` → the
   denial text; `unreachable` → the `unreachableError("claiming a task", detail)` text.

## Output

A single MCP text content block: the claim-success message, the
already-claimed/not-found message, the no-pool guard, or the error message.
Never throws.

## Dependencies & side effects

- `resolveAgentId()`, `proxyToApi`, and the shared proxy error helpers.
- Server-side: `claimTask` — `SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE` on
  `pipeline.tasks` and a best-effort `INSERT` into `pipeline.task_events`, inside
  a transaction on a dedicated client.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`, `LORE_AGENT_ID`. No database handle.

## Acceptance Criteria

A pending task is locked, flipped to `running` with the claiming agent, and the
transaction commits returning true. ([validated by `returns true and records the claim event when a pending task is claimed`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L148))

When the row is already locked or absent the handler rolls back and returns
false. ([validated by `returns false and records no event when the row is already claimed`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L164))

A failure recording the claim event does not abort the claim; the transaction
still commits. ([validated by `still returns true when the event-recording insert throws`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L175))

The resolved agent id is posted with the task id and a successful claim is
confirmed by name. ([validated by `lore_claim_task posts the resolved agent id and confirms the claim`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L394))

A refused claim renders the already-claimed/not-found message. ([validated by `lore_claim_task reports a task that could not be claimed`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L406))

An unconfigured API yields the not-configured message rather than a PostgreSQL
message. ([validated by `every proxied pipeline tool reports a missing API configuration`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L440))

## Out of Scope

- Selecting *which* task to claim — see [`lore_ready_tasks`](../ready-tasks/spec.md).
- Releasing / completing a claim — see [`lore_complete_task`](../complete-task/spec.md).
- Agent-id resolution rules (`resolveAgentId`).
