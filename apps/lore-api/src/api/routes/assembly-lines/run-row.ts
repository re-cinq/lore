// The run-row projection: schemas plus the cross-table enrichment (task PR + summed cost) joined onto a port-selected AssemblyRunSummary.

import type { Pool } from "pg";
import { z } from "zod";
import { StationRunInputSchema } from "@re-cinq/lore-shared/models/station-run.js";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

/** Postgres "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

export const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

// Cross-table half of a run read (task PR + summed cost), joined onto the port-selected (id, task_id) pairs; cost_usd falls back to the task's calls for runs predating per-line attribution (llm_calls.assembly_line_id keeps its pre-rename spelling — 0040 telemetry carve-out).
const ENRICH_SELECT = `
  SELECT r.id,
         t.pr_url, t.pr_number AS task_pr_number, t.created_by,
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

// A CROSS-TABLE read model (task PR + summed cost + args pr_number), not a projection of pipeline.assembly_runs; snake_case keys since that's what deployed web-ui reads, deliberately apart from the AssemblyRun model.
export const RunRowSchema = z.object({
  id: z.string(),
  blueprint_name: z.string(),
  definition_name: z.string(),
  task_id: z.string().nullable(),
  repo: z.string(),
  branch: z.string().nullable(),
  subject_key: z.string().nullable(),
  graph: z.unknown().optional(),
  status: z.string(),
  outcome: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  args_pr_number: z.number().nullable(),
  pr_url: z.string().nullable(),
  task_pr_number: z.number().nullable(),
  created_by: z.string().nullable(),
  cost_usd: z.number().nullable(),
});

export const RunListSchema = z.object({ runs: z.array(RunRowSchema) });

/** One `pipeline.station_runs` row as the run page reads it. */
export const StationRunRowSchema = z.object({
  node_id: z.string(),
  iteration: z.number(),
  outcome: z.string().nullable(),
  agent_cr_name: z.string().nullable(),
  station_run_id: z.string().nullable(),
  // What the visit was dispatched with; null for visits predating the column means "not captured", not "no input".
  input: StationRunInputSchema.nullable(),
  commit_sha: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export const StationRunListSchema = z.object({
  nodes: z.array(StationRunRowSchema),
});

export const TokenUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cache_read_tokens: z.number(),
});

// The four ENRICH_SELECT columns, picked from the RunRowSchema wire contract declared above.
type RunEnrichment = Pick<
  z.infer<typeof RunRowSchema>,
  "pr_url" | "task_pr_number" | "created_by" | "cost_usd"
>;

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

// PR number from a run's args, or null; a bare Number() coercion turns null/"" into 0, rendering a link to a PR that doesn't exist — the replaced SQL answered NULL for both.
function argsPrNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}

// Present only when withGraph asked for it; graph itself may still be unresolved (predates clones AND blueprint gone).
function graphField(
  withGraph: boolean,
  graph: unknown,
): Record<string, unknown> {
  if (!withGraph) {
    return {};
  }

  return { graph: graph ?? null };
}

// enrichment is a same-shaped fallback away from its own fields once it's known to exist — only created_by falls further, to the run's own recorded actor.
function enrichedFields(
  enrichment: RunEnrichment | undefined,
  argsActor: unknown,
): RunEnrichment {
  const actorFallback = (argsActor as string | null) ?? null;

  if (!enrichment) {
    return {
      pr_url: null,
      task_pr_number: null,
      created_by: actorFallback,
      cost_usd: null,
    };
  }

  return {
    pr_url: enrichment.pr_url,
    task_pr_number: enrichment.task_pr_number,
    created_by: enrichment.created_by ?? actorFallback,
    cost_usd: enrichment.cost_usd,
  };
}

// One run as the run views read it; definition_name doubles blueprint_name under its pre-rename spelling for the legacy-alias rollout window — DELETE alongside that alias.
export function toRunRow(
  run: AssemblyRunSummary & { graph?: unknown },
  enrichment: RunEnrichment | undefined,
  withGraph: boolean,
) {
  const { pr_url, task_pr_number, created_by, cost_usd } = enrichedFields(
    enrichment,
    run.args["actor"],
  );

  return {
    id: run.id,
    blueprint_name: run.blueprintName,
    definition_name: run.blueprintName,
    task_id: run.taskId,
    repo: run.repo,
    branch: run.branch,
    subject_key: run.subjectKey,
    ...graphField(withGraph, run.graph),
    status: run.status,
    outcome: run.outcome,
    reason: run.reason,
    created_at: run.createdAt.toISOString(),
    started_at: isoOrNull(run.startedAt),
    finished_at: isoOrNull(run.finishedAt),
    args_pr_number: argsPrNumber(run.args["pr_number"]),
    pr_url,
    task_pr_number,
    created_by,
    cost_usd,
  };
}
