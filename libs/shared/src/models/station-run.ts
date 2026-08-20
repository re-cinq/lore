import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.station_runs` — ONE visit to a Station within an AssemblyRun,
 * i.e. `(run, node, iteration)` (ADR-024).
 *
 * DDL: migration `0025_assembly_lines.sql` (as `assembly_line_nodes`), the
 * attempt-uniqueness index in `0029`, renamed and given `station_run_id` by
 * `0040_assembly_runs.sql`.
 *
 * Two ids on purpose. `id` is the physical row id and ALSO the visit order the
 * replay depends on; `stationRunId` is the visit's public identity, which
 * telemetry and cost rows key on instead of string-matching an Agent CR name
 * (FR6.39).
 */

export const StationRunSchema = z.object({
  id: z.string(),
  stationRunId: z.string(),
  assemblyRunId: z.string(),
  nodeId: z.string(),
  iteration: z.number(),
  outcome: z.string().nullable(),
  agentCrName: z.string().nullable(),
  commitSha: z.string().nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});

export type StationRun = z.infer<typeof StationRunSchema>;

export const STATION_RUN_COLUMNS = {
  id: "id",
  stationRunId: "station_run_id",
  assemblyRunId: "assembly_run_id",
  nodeId: "node_id",
  iteration: "iteration",
  outcome: "outcome",
  agentCrName: "agent_cr_name",
  commitSha: "commit_sha",
  startedAt: "started_at",
  finishedAt: "finished_at",
} as const satisfies ColumnMap<StationRun>;

export const STATION_RUN_TABLE = "pipeline.station_runs";
