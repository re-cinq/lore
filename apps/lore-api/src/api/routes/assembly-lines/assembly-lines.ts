import type { Pool } from "pg";
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

/**
 * The assembly-line reads the run views need, moved here verbatim from web-ui's
 * `lib/assembly-line-runs.ts` (ADR-032: the UI is a presentation tier and holds
 * no pool). The SQL is unchanged — a rewrite would have to re-earn the LATERAL
 * cost fallback below, which is load-bearing.
 *
 * Every read degrades to empty rather than 500 on a database that predates the
 * tables (migration 0025 for the lines, 0037 for the turns): a run view is
 * additive, and taking a page down because a cluster has not migrated yet is
 * worse than showing it without runs.
 */

/** Postgres "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

/**
 * The cross-table half of a run read: the task's PR and the summed cost.
 *
 * WHICH runs to answer with is the port's decision — `list`/`listSummaries` own
 * the filter, the order and the limit, and duplicating them here is how "every
 * code-review run" came to mean two different things depending on the endpoint.
 * This query never touches `pipeline.assembly_runs` at all: it is handed the
 * (id, task_id) pairs the port selected and joins the two OTHER tables onto them.
 *
 * `cost_usd` falls back to the TASK's calls when a call predates per-line
 * attribution — dropping that fallback silently zeroes the cost of every run
 * started before `llm_calls.assembly_line_id` existed. (That column keeps its
 * pre-rename spelling deliberately — 0040's telemetry carve-out; the new one
 * arrives with the writer-flip.)
 */
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

/**
 * The PR number a run's args carry, or null when they carry none.
 *
 * `Number(null)` is 0, `Number("")` is 0, and `Number.isFinite` is happy with
 * both — so a bare coercion serves `args_pr_number: 0` for a run whose args hold
 * an explicit null, and the run page renders a link to a PR that does not exist.
 * The SQL this replaced lifted the value with `(args->>'pr_number')::int`, which
 * answers NULL for both.
 */
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

/**
 * One run as the run views read it.
 *
 * `definition_name` doubles the blueprint name under its pre-rename spelling for
 * the web-ui image behind the legacy path alias — an old client that maps
 * `row.definition_name` would otherwise render blank names in the exact rollout
 * window the alias exists for. DELETE alongside the alias.
 *
 * Dates go out as ISO strings, which is what the contract below declares and
 * what the pg driver's `Date` serialized to anyway.
 */
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

/**
 * What the run reads answer with.
 *
 * A CROSS-TABLE read model, not a projection of `pipeline.assembly_runs`: it
 * carries the task's PR, the summed cost from `pipeline.llm_calls`, and the
 * `args->>'pr_number'` lift. Its keys stay snake_case because that is what the
 * deployed web-ui reads — the `AssemblyRun` MODEL is the table's shape, and this
 * is the contract over it, so the two live apart on purpose.
 *
 * `definition_name` doubles `blueprint_name` for the rollout window described
 * above; it goes when the legacy path alias does.
 */
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
  /** What the visit was dispatched with. Null for visits recorded before the
   *  column existed — "not captured", not "no input". */
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
  /** Browse by blueprint — "every code-review run", which nothing could ask for
   *  before (FR6.42). */
  blueprint: z.string().max(200).optional(),
  /** A task-centric caller (the planning wizard) knows only its task id; the run
   *  to draw is the newest attempt, since a retry mints a fresh row. */
  task_id: z.string().max(100).optional(),
  /** Browse by SUBJECT — every run that has worked on one thing, whatever
   *  blueprint each ran. This is how a reader finds "the run for this feature"
   *  without knowing which task started it or which line it turned out to be;
   *  resolving it through task id + blueprint name is what made a feature's
   *  finalize run invisible to its own page. */
  subject_key: z.string().max(200).optional(),
  limit: clampedLimit.default(50),
});

type RunsQuery = z.infer<typeof RunsQuery>;

/**
 * The canonical paths are `/api/assembly-runs/*` (FR6.41 — the runtime model is an
 * AssemblyRun; an assembly line is the blueprint). Every route is ALSO served at
 * its pre-rename `/api/assembly-lines/*` path, because web-ui ships as a separate
 * image in the same umbrella release and would otherwise 404 against a newer API
 * for the length of a rollout.
 *
 * DELETE the aliases once no deployed client calls them.
 */
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
  /** Injected by the tests; production builds one per request off the pool, as
   *  `run-read.ts` does. */
  runs?: AssemblyRunsPort,
): ServerRoute[] {
  /** The port a handler reads through: the injected one, or one over the pool
   *  this request resolved. Named once — three handlers building their own is
   *  three places to remember when the adapter's construction changes. */
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

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { status, repo, blueprint, task_id, subject_key, limit } =
          request.query as unknown as RunsQuery;
        const port = portFor(pool);

        try {
          // A task-centric caller draws the run it gets back, so it needs the
          // clone; a browse page renders tables that never touch it.
          const selected = task_id
            ? await port.list({ taskId: task_id, limit })
            : await port.listSummaries({
                repo,
                blueprintName: blueprint,
                status: status ? [status as AssemblyRunStatus] : undefined,
                subjectKey: subject_key,
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

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

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

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        // `pipeline.agent_run_turns`, NOT `pipeline.llm_calls`: the cost table is
        // authoritative and carries dollars, but a row lands only when an agent
        // run ENDS — which for a planning round is the moment the card showing
        // the number disappears. Turns arrive while the pod streams, so they are
        // the only source that can answer "so far" while something still runs.
        // Summed SQL-side: four scalars beat shipping every turn of a long run.
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
    // The FLAT by-id read, now served ONLY under the legacy spelling. The
    // canonical /api/assembly-runs/{id} serves the enriched shape (the run, its
    // nodes, and the Station each node dispatches to) from run-read.ts. This one
    // stays until the deployed web-ui moves to that shape — web-ui ships as its
    // own image, so one side of a rollout is always older than the other.
    // DELETE with the aliases (#1347 PR3).
    //
    // Registered OUTSIDE withLegacyAlias deliberately: passing it through would
    // alias the legacy path to itself and hapi rejects the duplicate route.
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

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        try {
          const run = await portFor(pool).getById(request.params.id);

          if (!run) {
            return h.response({ error: "Run not found" }).code(404);
          }
          const enrichment = await enrichmentById(pool, [run]);

          return h.response(toRunRow(run, enrichment.get(run.id), true));
        } catch (err) {
          if (missingTable(err)) {
            // Same answer as "no such run": a database with no table holds none,
            // and the id resolver falls through to treating it as a task id.
            return h.response({ error: "Run not found" }).code(404);
          }

          throw err;
        }
      },
    },
  ]);
}
