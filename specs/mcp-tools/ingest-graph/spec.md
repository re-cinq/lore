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
**Specs and ADRs are projected automatically by CI** — the repo's `lore-ingest.yml`
fans out one job per kind that fires the spec-trace projection trigger (see
[ADR-023](../../../adrs/ADR-023-test-run-trace-binding.md)); they are no longer
pipeline tasks. The one ingest that still needs a task is **tests**: it runs the
project's test suite (via the `.lore/test-commands.yml` interface), so it executes
only in a trusted sandbox (local dev / CI / a runner pod). `lore_ingest_graph`
creates that `ingest-tests` task so a `lore_run_task_locally` (or the cluster
runner) can pick it up. It is idempotent: an in-flight `ingest-tests` task is
skipped.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/spec-trace-tools.ts#L10)).

- **name**: `lore_ingest_graph`
- **description** (verbatim):

```text
WRITE side of spec-traceability for the TEST suite: creates an ingest-tests pipeline task (run it locally / in CI to project test→spec coverage into the graph). Specs and ADRs project automatically via CI (lore-ingest.yml fans out per-kind jobs that fire the projection trigger), not this tool. Idempotent — an in-flight ingest-tests task is skipped. Instead: to READ spec coverage from the built graph use lore-query-trace; to enumerate or run tests locally use lore_list_tests / lore_run_test.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | — | Target repo as 'owner/repo'. Defaults to the repo detected from cwd git remote. |
| `ref` | string | no | — | Branch name or commit SHA. Defaults to the repo's default branch. |

## Behavior

1. **Repo resolution** — `targetRepo = repo || detectCurrentRepo()`. If both are
   empty, return the literal text
   `"No repo specified and could not detect the current repo (run inside a git repo or pass `repo`)."`
2. **Availability gate** — `dbPoolRef = getPool()`. If null, return the literal
   text `"Database not available — cannot create ingestion tasks."`
3. Dynamic-import and call `createIngestGraphTasks(dbPoolRef, targetRepo,
   { kinds: ["tests"], branch: ref, createdBy: "lore_ingest_graph" })`
   ([handler](../../../apps/mcp-server/src/features/spec-trace/ingest-graph-tasks.ts#L25)):
   1. Generate one `groupId = randomUUID()`.
   2. `taskType = "ingest-tests"`. **Dedupe** — `SELECT id FROM pipeline.tasks
      WHERE target_repo = $1 AND task_type = $2 AND status IN
      ('pending','queued','running','running-local') LIMIT 1`. If a row exists,
      push `tests` to `skipped` and continue (so re-runs never stack duplicate
      in-flight tasks).
   3. Otherwise `createPipelineTask(pool, { taskType, description: "Ingest tests
      → graph for {repo}", targetRepo, createdBy, taskGroupId: groupId,
      contextBundle: { kind: "tests", branch } })` and push `{ id, kind }` to
      `created`.
   4. Return `{ groupId, created, skipped }`.
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
  one dedupe `SELECT`, then **inserts** one `pipeline.tasks` row for the
  `ingest-tests` task (also recording a `pending` task event). `ingest-tests` is
  allowed at every trust tier (zero-LLM, no PR).
- No graph nodes are written by this tool — that happens later when the runner
  executes the `ingest-tests` task.

## Acceptance Criteria

`createIngestGraphTasks` returns the created task's id under `created[].kind`. ([validated by `sets created[].id to the created task's task_id`](../../../apps/mcp-server/src/features/spec-trace/ingest-graph-tasks.test.ts#L27))

The REST `/ingest-graph` endpoint that CI calls fires the spec-trace trigger for the `specs` kind and creates no task. ([validated by `fires the spec-trace trigger for the specs kind and creates no task`](../../../apps/mcp-server/src/api/routes/ingest-graph.test.ts#L32))

The same endpoint keeps the pipeline-task path for the `tests` kind and fires no doc trigger. ([validated by `keeps the task path for the tests kind and fires no doc trigger`](../../../apps/mcp-server/src/api/routes/ingest-graph.test.ts#L52))

The tool wrapper's repo/db guards and the in-flight dedupe branch are exercised
only against a live DB. *(untested: the dedupe `SELECT` + insert and the
success-string assembly have no pure seam in the wrapper.)*

## Out of Scope

- **Spec/ADR projection** — now CI-driven via the spec-trace trigger (ADR-023);
  not this tool. The per-kind graph projection (Spec/Section/Statement/TestChunk/
  Coverage node writes) is owned by `runIngestGraph` and the
  `spec-traceability-graph` projection layer.
- Reading the graph — `query_trace` (specified separately).
