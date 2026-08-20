import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";
import type { RunGraph } from "../project/assembly-runs/run-graph.js";

/**
 * `pipeline.assembly_runs` — ONE execution of an AssemblyLine (ADR-024's
 * 2026-08-14 amendment: a blueprint is not a run).
 *
 * DDL: migration `0025_assembly_lines.sql`, renamed by `0040_assembly_runs.sql`
 * (`definition_name` → `blueprint_name`, `definition_hash` → `blueprint_hash`,
 * `resumed_from_line_id` → `resumed_from_run_id`, plus `graph`), and extended by
 * `0041_assembly_runs_subject_key.sql`.
 *
 * `repo` is the canonical `owner/repo` STRING, never `lore.repos.id`: FR6.42
 * resolves an id at the caller rather than denormalizing it here, where a GitHub
 * rename would silently rot it.
 *
 * `graph` is the blueprint CLONE this run executes. It is carried as the exact
 * `RunGraph` rather than re-described in zod: the graph is a persisted wire
 * format with its own module and its own web-ui drift guard, and restating its
 * shape here would be a second declaration of precisely the kind this folder
 * exists to remove.
 */

export const AssemblyRunStatusSchema = z.enum([
  "queued",
  "running",
  "finished",
  "failed",
]);

export const AssemblyRunSchema = z.object({
  id: z.string(),
  blueprintName: z.string(),
  taskId: z.string().nullable(),
  repo: z.string(),
  branch: z.string().nullable(),
  subjectKey: z.string().nullable(),
  args: z.record(z.unknown()),
  status: AssemblyRunStatusSchema,
  outcome: z.string().nullable(),
  reason: z.string().nullable(),
  blueprintHash: z.string().nullable(),
  graph: z.custom<RunGraph>().nullable(),
  resumedFromRunId: z.string().nullable(),
  resumedFromNodeId: z.string().nullable(),
  inheritedNodeCount: z.number(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
});

export type AssemblyRunStatus = z.infer<typeof AssemblyRunStatusSchema>;
export type AssemblyRun = z.infer<typeof AssemblyRunSchema>;

export const ASSEMBLY_RUN_COLUMNS = {
  id: "id",
  blueprintName: "blueprint_name",
  taskId: "task_id",
  repo: "repo",
  branch: "branch",
  subjectKey: "subject_key",
  args: "args",
  status: "status",
  outcome: "outcome",
  reason: "reason",
  blueprintHash: "blueprint_hash",
  graph: "graph",
  resumedFromRunId: "resumed_from_run_id",
  resumedFromNodeId: "resumed_from_node_id",
  inheritedNodeCount: "inherited_node_count",
  createdAt: "created_at",
  startedAt: "started_at",
  finishedAt: "finished_at",
} as const satisfies ColumnMap<AssemblyRun>;

export const ASSEMBLY_RUN_TABLE = "pipeline.assembly_runs";
