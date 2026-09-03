import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { StationRunInputSchema } from "@re-cinq/lore-shared/models/station-run.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { clampedLimit, DB_UNAVAILABLE } from "../common-schemas.js";
import type {
  AssemblyRunsPort,
  AssemblyRunSummary,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AssemblyRunStatus } from "@re-cinq/lore-shared/models/assembly-run.js";

// Assembly-line reads for the run views, moved verbatim from web-ui (ADR-032: UI holds no pool); every read degrades to empty (not 500) on a database predating migrations 0025/0037.

/** Postgres "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
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

interface RunEnrichment {
  pr_url: string | null;
  task_pr_number: number | null;
  created_by: string | null;
  cost_usd: number | null;
}

async function enrichmentById(
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

// One run as the run views read it; definition_name doubles blueprint_name under its pre-rename spelling for the legacy-alias rollout window — DELETE alongside that alias.
function toRunRow(
  run: AssemblyRunSummary & { graph?: unknown },
  enrichment: RunEnrichment | undefined,
  withGraph: boolean,
) {
  return {
    id: run.id,
    blueprint_name: run.blueprintName,
    definition_name: run.blueprintName,
    task_id: run.taskId,
    repo: run.repo,
    branch: run.branch,
    subject_key: run.subjectKey,
    ...(withGraph ? { graph: run.graph ?? null } : {}),
    status: run.status,
    outcome: run.outcome,
    reason: run.reason,
    created_at: run.createdAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
    args_pr_number: argsPrNumber(run.args["pr_number"]),
    pr_url: enrichment?.pr_url ?? null,
    task_pr_number: enrichment?.task_pr_number ?? null,
    created_by:
      enrichment?.created_by ?? (run.args["actor"] as string | null) ?? null,
    cost_usd: enrichment?.cost_usd ?? null,
  };
}

// A CROSS-TABLE read model (task PR + summed cost + args pr_number), not a projection of pipeline.assembly_runs; snake_case keys since that's what deployed web-ui reads, deliberately apart from the AssemblyRun model.
const RunRowSchema = z.object({
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

const RunListSchema = z.object({ runs: z.array(RunRowSchema) });

/** One `pipeline.station_runs` row as the run page reads it. */
const StationRunRowSchema = z.object({
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

const StationRunListSchema = z.object({
  nodes: z.array(StationRunRowSchema),
});

const TokenUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cache_read_tokens: z.number(),
});

const RunsQuery = z.object({
  status: z.string().max(40).optional(),
  repo: z.string().max(200).optional(),
  // Browse by blueprint — "every code-review run" (FR6.42).
  blueprint: z.string().max(200).optional(),
  // A task-centric caller (planning wizard) knows only its task id; draws the newest attempt since a retry mints a fresh row.
  task_id: z.string().max(100).optional(),
  // Runs with an open station-run claimed by this cluster-agent — the registered-clusters running-claims drill-down (FR7).
  cluster_agent_id: z.string().uuid().optional(),
  // Browse by SUBJECT across blueprints, so a reader can find "the run for this feature" without resolving via task id + blueprint name (which hid a finalize run from its own page).
  subject_key: z.string().max(200).optional(),
  limit: clampedLimit.default(50),
});

type RunsQuery = z.infer<typeof RunsQuery>;

// Canonical paths are /api/assembly-runs/* (FR6.41); also served at pre-rename /api/assembly-lines/* since web-ui ships as a separate image and would 404 otherwise. DELETE the aliases once no deployed client calls them.
function withLegacyAlias(routes: ServerRoute[]): ServerRoute[] {
  return routes.flatMap((route) => [
    route,
    {
      ...route,
      path: route.path.replace("/api/assembly-runs", "/api/assembly-lines"),
    },
  ]);
}

export function assemblyLineRoutes(
  getPool: () => Pool | null,
  // Injected by tests; production builds one per request off the pool, as run-read.ts does.
  runs?: AssemblyRunsPort,
): ServerRoute[] {
  // The port a handler reads through, named once so three handlers don't each rebuild it.
  const portFor = (pool: Pool): AssemblyRunsPort =>
    runs ?? new PgAssemblyRuns(pool);

  return withLegacyAlias([
    {
      method: "GET",
      path: "/api/assembly-runs",
      options: zodResponse(
        {
          ...bearerScope("read"),
          validate: { query: zodValidate(RunsQuery) },
        },
        RunListSchema,
        {
          name: "AssemblyRunList",
          description: "A page of runs, newest first",
        },
      ),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const {
          status,
          repo,
          blueprint,
          task_id,
          subject_key,
          cluster_agent_id,
          limit,
        } = request.query as unknown as RunsQuery;
        const port = portFor(pool);

        try {
          // A task-centric caller draws the run it gets back (needs the clone); a browse page renders tables that never touch it.
          const selected = task_id
            ? await port.list({ taskId: task_id, limit })
            : await port.listSummaries({
                repo,
                blueprintName: blueprint,
                status: status ? [status as AssemblyRunStatus] : undefined,
                subjectKey: subject_key,
                clusterAgentId: cluster_agent_id,
                limit,
              });
          const enrichment = await enrichmentById(pool, selected);

          return h.response({
            runs: selected.map((run) =>
              toRunRow(run, enrichment.get(run.id), task_id !== undefined),
            ),
          });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ runs: [] });
          }

          throw err;
        }
      },
    },

    {
      method: "GET",
      path: "/api/assembly-runs/{id}/nodes",
      options: zodResponse(bearerScope("read"), StationRunListSchema, {
        name: "StationRunList",
        description: "The run's station visits, in visit order",
      }),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        try {
          const visits = await portFor(pool).listStationRuns(request.params.id);

          return h.response({
            nodes: visits.map((visit) => ({
              node_id: visit.nodeId,
              station_run_id: visit.stationRunId,
              iteration: visit.iteration,
              outcome: visit.outcome,
              agent_cr_name: visit.agentCrName,
              input: visit.input,
              commit_sha: visit.commitSha,
              started_at: visit.startedAt.toISOString(),
              finished_at: visit.finishedAt?.toISOString() ?? null,
            })),
          });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ nodes: [] });
          }

          throw err;
        }
      },
    },

    {
      method: "GET",
      path: "/api/assembly-runs/{id}/token-usage",
      options: zodResponse(bearerScope("read"), TokenUsageSchema, {
        name: "AssemblyRunTokenUsage",
        description: "Tokens spent so far on the run",
      }),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        // pipeline.agent_run_turns, NOT llm_calls: the cost table only lands a row when the run ENDS, but turns arrive while the pod streams — the only source that can answer "so far".
        try {
          const { rows } = await pool.query(
            `SELECT
               COALESCE(SUM((usage->>'input_tokens')::bigint), 0)::int AS input_tokens,
               COALESCE(SUM((usage->>'output_tokens')::bigint), 0)::int AS output_tokens,
               COALESCE(SUM((usage->>'cache_creation_input_tokens')::bigint), 0)::int
                 AS cache_creation_tokens,
               COALESCE(SUM((usage->>'cache_read_input_tokens')::bigint), 0)::int
                 AS cache_read_tokens
             FROM (
               SELECT envelope->'event'->'message'->'usage' AS usage
                 FROM pipeline.agent_run_turns
                WHERE assembly_line_id = $1
                  AND envelope->'event'->'message' ? 'usage'
             ) turns`,
            [request.params.id],
          );

          return h.response({ usage: rows[0] ?? null });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ usage: null });
          }

          throw err;
        }
      },
    },
  ]).concat([
    // FLAT by-id read, served ONLY under the legacy spelling now (canonical /api/assembly-runs/{id} serves the enriched shape from run-read.ts); DELETE with the aliases (#1347 PR3). Registered OUTSIDE withLegacyAlias deliberately — aliasing it to itself would make hapi reject the duplicate route.
    {
      method: "GET",
      path: "/api/assembly-lines/{id}",
      options: zodResponse(bearerScope("read"), RunRowSchema, {
        name: "AssemblyRunDetail",
        description: "One run, carrying the blueprint clone it walked",
        errors: [404],
      }),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        try {
          const run = await portFor(pool).getById(request.params.id);

          enforceTrue(run, apiError(404), "Run not found");
          const enrichment = await enrichmentById(pool, [run]);

          return h.response(toRunRow(run, enrichment.get(run.id), true));
        } catch (err) {
          // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
          rethrowBoom(err);

          enforceTrue(!missingTable(err), apiError(404), "Run not found");

          throw err;
        }
      },
    },
  ]);
}
