// The run-row projection: schemas plus the cross-table enrichment (task PR + summed cost) joined onto a port-selected AssemblyRunSummary.

import type { Pool } from "pg";
import { z } from "zod";
import {
  StationRunRowSchema,
  toStationRunRow,
} from "../../../work/assembly-runs/station-run-row.js";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  RunRowSchema,
  toRunRow,
  toRunRowWithGraph,
  type RunEnrichment,
} from "../../../work/assembly-runs/run-row.js";

/** Postgres "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

export const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

// Cross-table half of a run read (task PR + task Issue + summed cost), joined onto the port-selected (id, task_id) pairs; cost_usd falls back to the task's calls for runs predating per-line attribution (llm_calls.assembly_line_id keeps its pre-rename spelling — 0040 telemetry carve-out).
const ENRICH_SELECT = `
  SELECT r.id,
         t.pr_url, t.pr_number AS task_pr_number, t.created_by,
         t.issue_url, t.issue_number,
         cost.cost_usd
    FROM unnest($1::uuid[], $2::uuid[]) AS r(id, task_id)
    LEFT JOIN pipeline.tasks t ON t.id = r.task_id
    LEFT JOIN LATERAL (
      SELECT SUM(lc.cost_usd)::float AS cost_usd
        FROM pipeline.llm_calls lc
       WHERE lc.assembly_line_id = r.id
          OR (lc.assembly_line_id IS NULL
              AND r.task_id IS NOT NULL
              AND lc.task_id = r.task_id)
    ) cost ON true`;

export const RunListSchema = z.object({ runs: z.array(RunRowSchema) });

export {
  RunRowSchema,
  StationRunRowSchema,
  toRunRow,
  toRunRowWithGraph,
  toStationRunRow,
};
export type { RunEnrichment };

export const StationRunListSchema = z.object({
  nodes: z.array(StationRunRowSchema),
});

export const TokenUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cache_read_tokens: z.number(),
});

export async function enrichmentById(
  pool: Pool,
  runs: readonly AssemblyRunSummary[],
): Promise<Map<string, RunEnrichment>> {
  if (runs.length === 0) {
    return new Map();
  }
  const { rows } = await pool.query<RunEnrichment & { id: string }>(
    ENRICH_SELECT,
    [runs.map((run) => run.id), runs.map((run) => run.taskId)],
  );

  return new Map(rows.map(({ id, ...enrichment }) => [id, enrichment]));
}
