import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
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
    runTokenUsageRoute(getPool, portFor),
    // runDetailRoute stays OUTSIDE the alias: it is already spelled the legacy way, and aliasing it to itself makes hapi reject the duplicate route.
  ]).concat([runDetailRoute(getPool, portFor)]);
}

/** A task-centric caller DRAWS the run it gets back, so it needs the full record; a browse page renders tables that never touch the graph, so it gets summaries. */
async function selectRuns(
  port: AssemblyRunsPort,
  query: RunsQuery,
): Promise<Awaited<ReturnType<AssemblyRunsPort["listSummaries"]>>> {
  if (query.task_id) {
    return await port.list({ taskId: query.task_id, limit: query.limit });
  }

  return await port.listSummaries({
    repo: query.repo,
    blueprintName: query.blueprint,
    status: query.status ? [query.status as AssemblyRunStatus] : undefined,
    subjectKey: query.subject_key,
    clusterAgentId: query.cluster_agent_id,
    limit: query.limit,
  });
}

/** The selected runs already enriched into wire rows; a task-centric caller gets the full record so it can draw the graph. */
async function runListRows(
  pool: Pool,
  port: AssemblyRunsPort,
  query: RunsQuery,
) {
  const selected = await selectRuns(port, query);
  const enrichment = await enrichmentById(pool, selected);

  return selected.map((run) =>
    toRunRow(run, enrichment.get(run.id), query.task_id !== undefined),
  );
}

/** A page of runs, newest first. Filters are applied in SQL rather than after the fetch, because a busy org's run table is large and the page is small. */
async function serveRunList(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const query = request.query as unknown as RunsQuery;

  try {
    const runs = await runListRows(pool, portFor(pool), query);

    return h.response({ runs });
  } catch (err) {
    if (missingTable(err)) {
      return h.response({ runs: [] });
    }

    throw err;
  }
}

function listRunsRoute(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
): ServerRoute {
  const validate = { query: zodValidate(RunsQuery) };
  const meta = {
    name: "AssemblyRunList",
    description: "A page of runs, newest first",
  };

  return {
    method: "GET",
    path: "/api/assembly-runs",
    options: zodResponse(
      { ...bearerScope("read"), validate },
      RunListSchema,
      meta,
    ),
    handler: (request, h) => serveRunList(getPool, portFor, request, h),
  };
}

type StationRunVisit = Awaited<
  ReturnType<AssemblyRunsPort["listStationRuns"]>
>[number];

/** One station visit as the timeline draws it. */
function stationRunRow(visit: StationRunVisit) {
  return {
    node_id: visit.nodeId,
    station_run_id: visit.stationRunId,
    iteration: visit.iteration,
    outcome: visit.outcome,
    agent_cr_name: visit.agentCrName,
    input: visit.input,
    commit_sha: visit.commitSha,
    started_at: visit.startedAt.toISOString(),
    finished_at: visit.finishedAt?.toISOString() ?? null,
  };
}

/** The run's station visits in VISIT order, not node order — a line that loops visits the same node more than once, and the sequence is what the timeline draws. */
async function serveRunNodes(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  try {
    const visits = await portFor(pool).listStationRuns(request.params.id);

    return h.response({ nodes: visits.map(stationRunRow) });
  } catch (err) {
    if (missingTable(err)) {
      return h.response({ nodes: [] });
    }

    throw err;
  }
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
    handler: (request, h) => serveRunNodes(getPool, portFor, request, h),
  };
}

/** Tokens spent on the run so far. Summed from llm_calls rather than stored on the run, so a run still in flight reports what it has spent up to now. */
/** Sums the run's tokens from `pipeline.agent_run_turns`, NOT `llm_calls`: the cost table only lands a row when the run ENDS, while turns arrive as the pod streams — this is the only source that can answer "so far". */
async function sumRunTokens(pool: Pool, runId: string): Promise<unknown> {
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
    [runId],
  );

  return rows[0] ?? null;
}

async function serveRunTokenUsage(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  try {
    return h.response({
      usage: await sumRunTokens(pool, request.params.id as string),
    });
  } catch (err) {
    if (missingTable(err)) {
      return h.response({ usage: null });
    }

    throw err;
  }
}

function runTokenUsageRoute(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/token-usage",
    options: zodResponse(bearerScope("read"), TokenUsageSchema, {
      name: "AssemblyRunTokenUsage",
      description: "Tokens spent so far on the run",
    }),
    handler: (request, h) => serveRunTokenUsage(getPool, portFor, request, h),
  };
}

/** The flat by-id record. A database predating the run tables reads as "not found" rather than a 500 — the row genuinely is not there. */
async function serveRunDetail(
  getPool: () => Pool | null,
  portFor: (pool: Pool) => AssemblyRunsPort,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
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
    handler: (request, h) => serveRunDetail(getPool, portFor, request, h),
  };
}
