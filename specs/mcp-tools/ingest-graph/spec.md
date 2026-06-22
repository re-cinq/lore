# Feature Specification: lore_ingest_graph MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_ingest_graph MCP Tool                  |
| Status  | **Draft**                              |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `lore_ingest_graph`                         |
| Module  | Spec-trace (`spec-trace-tools.ts`)     |
| Scope   | shared                                 |

## Problem Statement

The spec-traceability graph (Spec → Section → Statement → TestChunk, plus
Coverage edges) is built by projecting a repo's specs, ADRs, and test reports.
That projection is a per-kind job that walks source files and writes graph nodes.
`lore_ingest_graph` fans out one pipeline task per requested kind so the agent runner
(specs/adrs) or a local `lore_run_task_locally` (tests) can pick them up — without the
caller hand-creating three tasks and a group id. It is idempotent: re-running
when nothing changed is a no-op (only changed files re-project).

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/spec-trace-tools.ts#L10)).

- **name**: `lore_ingest_graph`
- **description** (verbatim):

```text
WRITE side of spec-traceability: creates one ingestion pipeline task per requested kind (specs, adrs, tests) and returns the created task ids under a single group id. Idempotent — in-flight tasks for a kind are skipped. Instead: to READ spec coverage from the built graph use lore-query-trace; to enumerate or run tests locally use lore_list_tests / lore_run_test.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | — | Target repo as 'owner/repo'. Defaults to the repo detected from cwd git remote. |
| `kinds` | string[] | no | — | Which kinds to ingest. Defaults to all three. |
| `ref` | string | no | — | Branch name or commit SHA. Defaults to the repo's default branch. |
| `force` | boolean | no | — | When true, re-processes all specs/adrs files even if content is unchanged. Has no effect on the tests kind. |

## Behavior

1. **Repo resolution** — `targetRepo = repo || detectCurrentRepo()`. If both are
   empty, return the literal text
   `"No repo specified and could not detect the current repo (run inside a git repo or pass `repo`)."`
2. **Availability gate** — `dbPoolRef = getPool()`. If null, return the literal
   text `"Database not available — cannot create ingestion tasks."`
3. Dynamic-import and call `createIngestGraphTasks(dbPoolRef, targetRepo,
   { kinds, branch: ref, createdBy: "lore_ingest_graph" })`
   ([handler](../../../apps/mcp-server/src/features/spec-trace/ingest-graph-tasks.ts#L23)):
   1. `kinds` defaults to `["specs", "adrs", "tests"]` when omitted or empty.
   2. Generate one `groupId = randomUUID()`.
   3. For each kind, `taskType = "ingest-{kind}"`. **Dedupe** — `SELECT id FROM
      pipeline.tasks WHERE target_repo = $1 AND task_type = $2 AND status IN
      ('pending','queued','running','running-local') LIMIT 1`. If a row exists,
      push the kind to `skipped` and continue (so re-runs never stack duplicate
      in-flight tasks).
   4. Otherwise `createPipelineTask(pool, { taskType, description: "Ingest {kind}
      → graph for {repo}", targetRepo, createdBy, taskGroupId: groupId,
      contextBundle: { kind, branch, commit, glob } })` and push `{ id, kind }` to
      `created`.
   5. Return `{ groupId, created, skipped }`.
4. **Success envelope** — build a bulleted list of `  • {kind}: {id}` lines and a
   `Skipped (already in flight): {kinds…}` note when any were skipped, then return
   `Created {N} ingestion task(s) for {repo} (group {groupId}):\n{lines}{skippedNote}\n\nRun one locally with: lore_run_task_locally <task_id>`.
5. Any thrown error is caught and returned as
   `"Error creating ingestion tasks: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the no-repo text, the
database-not-available text, the `Created N ingestion task(s) …` success block
(with the optional skipped note + the `lore_run_task_locally` hint), or the
`"Error creating ingestion tasks: …"` text. **Never throws** — every path returns
text.

## Dependencies & side effects

- `detectCurrentRepo()` (repo resolution).
- `getPool()` (pg pool; null-checked).
- `createIngestGraphTasks` → `createPipelineTask` (from `@re-cinq/lore-shared`):
  one dedupe `SELECT` per kind, then **inserts** one `pipeline.tasks` row per
  non-skipped kind (each also recording a `pending` task event). `ingest-*` task
  types are allowed at every trust tier (zero-LLM, no PR).
- No graph nodes are written by this tool — that happens later when the runner
  executes each `ingest-{kind}` task.

## Acceptance Criteria

The auto fan-out (which delegates to `createIngestGraphTasks`) creates
`ingest-specs` + `ingest-adrs` tasks when the repo opted in. ([validated by `creates specs+adrs tasks when auto_ingest_graph is enabled`](../../../apps/mcp-server/src/features/spec-trace/ingest-graph-tasks.test.ts#L26))

It creates no tasks when the `auto_ingest_graph` setting is off. ([validated by `does nothing when the setting is off`](../../../apps/mcp-server/src/features/spec-trace/ingest-graph-tasks.test.ts#L32))

It creates no tasks when repo settings are absent. ([validated by `does nothing when settings are absent`](../../../apps/mcp-server/src/features/spec-trace/ingest-graph-tasks.test.ts#L38))

The tool wrapper's repo/db guards and the per-kind in-flight dedupe branch are
exercised only against a live DB. *(untested: the dedupe `SELECT` + insert and the
success-string assembly have no pure seam in the wrapper; the `createIngestGraphTasks`
fan-out shape is covered transitively via the `maybeAutoIngestGraph` tests above.)*

## Out of Scope

- The actual per-kind graph projection (Spec/Section/Statement/TestChunk/Coverage
  node writes) — owned by the `ingest-{kind}` task runners and the
  `spec-traceability-graph` projection layer.
- Reading the graph — `query_trace` (specified separately).
- The auto post-onboard / post-ingest gate (`maybeAutoIngestGraph` settings flag).
