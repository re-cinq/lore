# Feature Specification: lore_ingest_graph MCP Tool (removed)

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_ingest_graph MCP Tool             |
| Status  | **Removed (2026-06-29)**               |
| Created | 2026-06-10                             |
| Tool    | `lore_ingest_graph` (deleted)          |
| Module  | Spec-trace                             |
| Scope   | shared                                 |

## Status

The `lore_ingest_graph` MCP tool has been **removed**. Its only job was to create
an `ingest-tests` pipeline task, and that task type is gone: **all three
spec-traceability projections are now CI-driven, none is a pipeline task** (see
[ADR-023](../../../adrs/ADR-023-test-run-trace-binding.md)).

- **Specs & ADRs** project via the repo's `lore-ingest.yml` → `POST /api/repos/:o/:r/ingest-graph`
  (`matrix: [specs, adrs]`), which inserts an `internal.ingest.spec_trace` event on the Floor
  event bus; the loop projects them into the graph.
- **Tests** project via the repo's `lore-tests.yml`, which runs the project's test
  suite (the `.lore/test-commands.yml` interface) and POSTs `/test-report` +
  `/coverage` directly. The cluster `ingest-tests` task was a self-skipping no-op
  anyway (the suite only runs in CI / a local sandbox, never on the shared agent).

To run the suite locally and project test coverage, use `npm run trace:run-tests`
(or `lore_list_tests` / `lore_run_test` for individual tests). To read coverage
from the built graph, use `lore-query-trace`.

## Surviving REST surface — `POST /api/repos/:o/:r/ingest-graph`

The REST route remains, **docs-only**: it inserts an `internal.ingest.spec_trace`
event for the `specs`/`adrs` kinds and rejects any other kind with `400` (test
projection is CI-only via `/test-report` + `/coverage`). Scope `write`.
Handler: [`mcp-server/src/api/routes/ingest-graph.ts`](../../../apps/mcp-server/src/api/routes/ingest-graph.ts).

## Acceptance Criteria

The endpoint inserts an `internal.ingest.spec_trace` event for the `specs` kind and creates no task. ([validated by `inserts a spec-trace event for the specs kind and creates no task`](../../../apps/mcp-server/src/api/routes/ingest-graph.test.ts#L23))

The endpoint rejects the `tests` kind with `400` (test projection is CI-only). ([validated by `rejects the tests kind with 400 (test projection is CI-only)`](../../../apps/mcp-server/src/api/routes/ingest-graph.test.ts#L44))

## Out of Scope

- Per-kind graph projection node writes (Spec/Section/Statement/TestChunk/Coverage)
  — owned by `runIngestGraph` and the spec-traceability projection layer.
- Reading the graph — `query_trace` (specified separately).
