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
 * Generated 2026-10-19 from 40 findings across 19 files; 6 more added same day
 * after the rule was fixed to handle exported type/interface declarations.
 * 10 more added same day — files missed in the initial scan.
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
  "libs/shared/src/domain/models/station-run.ts",
  "libs/shared/src/domain/models/test-report.ts",
  "libs/shared/src/domain/spec-blocks.ts",
  "libs/shared/src/domain/spec-trace/line-range.ts",
  "libs/shared/src/domain/spec-trace/test-declarations.ts",
  "libs/shared/src/domain/spec-trace/trace-scope.ts",
  "libs/shared/src/outbound/dgraph-vector.ts",
  "libs/shared/src/outbound/project/assembly-runs/assembly-runs-pg-lifecycle.ts",
  "libs/shared/src/outbound/project/assembly-runs/parked-node.ts",
  "libs/shared/src/outbound/project/chunks/chunks-memory-relocate.ts",
  "libs/shared/src/outbound/project/chunks/chunks-memory.ts",
  "libs/shared/src/outbound/project/leases/lease-backend-db.ts",
  "libs/shared/src/outbound/project/events/dedupe.ts",
  "libs/shared/src/outbound/project/events/event-tuning.ts",
  "libs/shared/src/outbound/project/knowledge/context-assembly-items.ts",
  "libs/shared/src/outbound/project/lib/platform-github-actions.ts",
  "libs/shared/src/outbound/project/lib/platform-github-pulls-write.ts",
  "libs/shared/src/transport/http/body-limits.ts",
  "libs/shared/src/transport/http/route-options.ts",
  "libs/shared/src/work/pr-section-check.ts",
  "libs/shared/src/work/spec-trace/impact-render.ts",
  "libs/shared/src/work/spec-trace/impact-statement-delta.ts",
  "libs/shared/src/work/spec-trace/statement-pairing.ts",
];
