/**
 * Source files that predate `lore/no-stranded-doc-comment`, listed so the rule
 * can be an error for every file written from here on. The pattern that triggers
 * it is two adjacent block doc comments stacked with nothing between them; the first
 * one describes nothing because only the second is attached to the declaration.
 *
 * The list only shrinks. Collapse the two comments into one (or separate them
 * with the declaration between them), then remove its line. When the list is
 * empty, delete this module and the config block that reads it.
 *
 * Generated 2026-10-19 from 40 findings across 19 files.
 */
export const NO_STRANDED_DOC_COMMENT_BASELINE = [
  "apps/lore-api/src/transport/routes/assembly-lines/run-read.ts",
  "apps/lore-api/src/transport/routes/context/context.ts",
  "apps/lore-api/src/transport/routes/graph/graph.ts",
  "apps/lore-api/src/transport/routes/ingest/event-payload.ts",
  "apps/lore-api/src/transport/routes/memory/episode.ts",
  "apps/lore-api/src/transport/routes/repos/repo-status.ts",
  "apps/lore-api/src/transport/routes/tasks/task-timeline.ts",
  "apps/lore-api/src/transport/routes/tasks/task-views.ts",
  "apps/lore-api/src/transport/routes/tokens/tokens.ts",
  "apps/lore-api/src/transport/routes/trace/trace-adrs.ts",
  "apps/lore-api/src/transport/routes/trace/trace-specs.ts",
  "apps/web-ui/src/app/repos/[owner]/[repo]/specs/StatementPopover.tsx",
  "apps/web-ui/src/components/LogEntriesView.tsx",
  "libs/shared/src/outbound/project/assembly-runs/assembly-runs-pg-lifecycle.ts",
  "libs/shared/src/outbound/project/assembly-runs/parked-node.ts",
  "libs/shared/src/outbound/project/chunks/chunks-memory-relocate.ts",
  "libs/shared/src/outbound/project/chunks/chunks-memory.ts",
  "libs/shared/src/outbound/project/leases/lease-backend-db.ts",
  "libs/shared/src/work/spec-trace/impact-statement-delta.ts",
];
