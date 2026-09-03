import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";
import type { RunGraph } from "../project/assembly-runs/run-graph.js";

/** One execution of an AssemblyLine; repo is owner/repo string; graph is the blueprint clone this run executes (see ADR-024). */

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
