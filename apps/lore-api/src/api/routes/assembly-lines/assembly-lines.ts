import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { clampedLimit, DB_UNAVAILABLE } from "../common-schemas.js";

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

// `cost_usd` falls back to the TASK's calls when a call predates per-line
// attribution — dropping that fallback silently zeroes the cost of every run
// started before `llm_calls.assembly_run_id` existed.
//
// `definition_name` doubles the blueprint name under its pre-rename spelling for
// the web-ui image behind the legacy path alias — an old client that maps
// `row.definition_name` would otherwise render blank names in the exact rollout
// window the alias exists for. DELETE alongside the alias.
const runSelect = (graphColumn: string) => `
  SELECT al.id, al.blueprint_name, al.blueprint_name AS definition_name,
         al.task_id, al.repo, al.branch,
         ${graphColumn}
         al.status, al.outcome, al.reason,
         al.created_at, al.started_at, al.finished_at,
         (al.args->>'pr_number')::int AS args_pr_number,
         t.pr_url, t.pr_number AS task_pr_number,
         COALESCE(t.created_by, al.args->>'actor') AS created_by,
         cost.cost_usd
    FROM pipeline.assembly_runs al
    LEFT JOIN pipeline.tasks t ON t.id = al.task_id
    LEFT JOIN LATERAL (
      SELECT SUM(lc.cost_usd)::float AS cost_usd
        FROM pipeline.llm_calls lc
       WHERE lc.assembly_run_id = al.id
          OR (lc.assembly_run_id IS NULL
              AND al.task_id IS NOT NULL
              AND lc.task_id = al.task_id)
    ) cost ON true`;

// The CLONE (FR6.38). Serving it is what lets a reader draw the graph a run
// ACTUALLY walked, instead of a UI-side transcription of the current YAML that
// goes wrong the moment a blueprint is edited or renamed. Only the readers that
// DRAW a run get it: the by-id read and the wizard's by-task read. The browse
// list renders tables that never touch it, so shipping up to LIMIT graphs per
// page would be pure transfer cost.
const RUN_DETAIL_SELECT = runSelect("al.graph,");
const RUN_BROWSE_SELECT = runSelect("");

const RunsQuery = z.object({
  status: z.string().max(40).optional(),
  repo: z.string().max(200).optional(),
  /** Browse by blueprint — "every code-review run", which nothing could ask for
   *  before (FR6.42). */
  blueprint: z.string().max(200).optional(),
  /** A task-centric caller (the planning wizard) knows only its task id; the run
   *  to draw is the newest attempt, since a retry mints a fresh row. */
  task_id: z.string().max(100).optional(),
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

export function assemblyLineRoutes(getPool: () => Pool | null): ServerRoute[] {
  return withLegacyAlias([
    {
      method: "GET",
      path: "/api/assembly-runs",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(RunsQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { status, repo, blueprint, task_id, limit } =
          request.query as unknown as RunsQuery;

        try {
          const { rows } = task_id
            ? await pool.query(
                `${RUN_DETAIL_SELECT} WHERE al.task_id = $1 ORDER BY al.created_at DESC LIMIT $2`,
                [task_id, limit],
              )
            : await pool.query(
                `${RUN_BROWSE_SELECT}
                  WHERE ($1::text IS NULL OR al.status = $1)
                    AND ($2::text IS NULL OR al.repo = $2)
                    AND ($3::text IS NULL OR al.blueprint_name = $3)
                  -- id breaks the tie: two runs created in the same millisecond
                  -- would otherwise come back in an order Postgres may vary
                  -- between calls, which reads as rows jumping around the list.
                  ORDER BY al.created_at DESC, al.id DESC
                  LIMIT $4`,
                [status ?? null, repo ?? null, blueprint ?? null, limit],
              );

          return h.response({ runs: rows });
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
      path: "/api/assembly-runs/{id}",
      options: bearerScope("read"),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        try {
          const { rows } = await pool.query(
            `${RUN_DETAIL_SELECT} WHERE al.id = $1`,
            [request.params.id],
          );

          return rows.length > 0
            ? h.response(rows[0])
            : h.response({ error: "Run not found" }).code(404);
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

    {
      method: "GET",
      path: "/api/assembly-runs/{id}/nodes",
      options: bearerScope("read"),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        try {
          const { rows } = await pool.query(
            `SELECT node_id, iteration, outcome, agent_cr_name, commit_sha,
                    started_at, finished_at
               FROM pipeline.station_runs
              WHERE assembly_run_id = $1
              ORDER BY id`,
            [request.params.id],
          );

          return h.response({ nodes: rows });
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
      options: bearerScope("read"),
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
                WHERE assembly_run_id = $1
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
  ]);
}
