import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { clampedLimit, DB_UNAVAILABLE } from "../common-schemas.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AssemblyRunStatus } from "@re-cinq/lore-shared/models/assembly-run.js";
import {
  enrichmentById,
  missingTable,
  RunListSchema,
  RunRowSchema,
  StationRunListSchema,
  toRunRow,
  TokenUsageSchema,
} from "./run-row.js";

// Assembly-line reads for the run views, moved verbatim from web-ui (ADR-032: UI holds no pool); every read degrades to empty (not 500) on a database predating migrations 0025/0037.

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
    listRunsRoute(getPool, portFor),
    runNodesRoute(getPool, portFor),
    runTokenUsageRoute(getPool),
    // runDetailRoute stays OUTSIDE the alias: it is already spelled the legacy way, and aliasing it to itself makes hapi reject the duplicate route.
  ]).concat([runDetailRoute(getPool, portFor)]);
}

function listRunsRoute(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
): ServerRoute {
  return {
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
  };
}

function runNodesRoute(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
): ServerRoute {
  return {
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
  };
}

function runTokenUsageRoute(getPool: () => Pool | null): ServerRoute {
  return {
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
  };
}

/** FLAT by-id read, served ONLY under the legacy spelling now (canonical /api/assembly-runs/{id} serves the enriched shape from run-read.ts); DELETE with the aliases (#1347 PR3). Registered OUTSIDE withLegacyAlias deliberately — aliasing it to itself would make hapi reject the duplicate route. */
function runDetailRoute(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
): ServerRoute {
  return {
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
  };
}
