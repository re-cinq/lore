import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import {
  clampedLimit,
  offsetParam,
  DB_UNAVAILABLE,
} from "../common-schemas.js";

/**
 * The activity reads behind the audit, gaps, events and job-run views, moved out
 * of web-ui (ADR-032). Three tables, one file: they are the same shape of read —
 * a filtered, paged look at what the platform did — and splitting them by table
 * would put three near-identical handlers in three files.
 */

const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

const MemoryAuditQuery = z.object({
  agent: z.string().max(200).optional(),
  operation: z.string().max(40).optional(),
  /** The gap view's lens: searches that returned nothing are the signal it
   *  exists to show, and filtering them in Node would page over the wrong set. */
  zero_results: z.coerce.boolean().optional(),
  limit: clampedLimit.default(50),
  offset: offsetParam,
});

type MemoryAuditQuery = z.infer<typeof MemoryAuditQuery>;

const EventsQuery = z.object({
  repo: z.string().min(1).max(200),
  limit: clampedLimit.default(20),
  offset: offsetParam,
});

type EventsQuery = z.infer<typeof EventsQuery>;

/** A dashboard count that must never take its page down: an absent table or a
 *  failed count reports null, and the panel renders without that figure. */
async function countOrNull(
  pool: Pool,
  sql: string,
  params: unknown[],
): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ c: number }>(sql, params);

    return rows[0]?.c ?? null;
  } catch {
    return null;
  }
}

export function activityRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/memory-audit",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(MemoryAuditQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { agent, operation, zero_results, limit, offset } =
          request.query as unknown as MemoryAuditQuery;

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (agent?.trim()) {
          params.push(agent.trim());
          conditions.push(`agent_id = $${params.length}`);
        }

        if (operation?.trim()) {
          params.push(operation.trim());
          conditions.push(`operation = $${params.length}`);
        }

        if (zero_results) {
          conditions.push(`metadata->>'result_count' = '0'`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

        const { rows: countRows } = await pool.query<{ count: number }>(
          `SELECT count(*)::int as count FROM memory.audit_log ${where}`,
          params,
        );
        const { rows: entries } = await pool.query(
          `SELECT id, agent_id, operation, memory_key, pool_name, metadata, created_at
             FROM memory.audit_log
             ${where}
            ORDER BY created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        );

        return h.response({ entries, total: countRows[0]?.count ?? 0 });
      },
    },

    {
      method: "GET",
      path: "/api/events",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(EventsQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { repo, limit, offset } = request.query as unknown as EventsQuery;

        try {
          const { rows } = await pool.query(
            `SELECT id, event_name, source, params, status, captured_at
               FROM pipeline.events
              WHERE repo = $1
              ORDER BY captured_at DESC
              LIMIT $2 OFFSET $3`,
            [repo, limit, offset],
          );

          return h.response({ events: rows });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ events: [] });
          }

          throw err;
        }
      },
    },

    {
      method: "GET",
      path: "/api/job-runs/{id}",
      options: bearerScope("read"),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { rows } = await pool.query(
          `SELECT id, job_name, status, started_at, completed_at,
                  result_summary, error, log_path
             FROM pipeline.job_runs WHERE id = $1`,
          [request.params.id],
        );

        return rows.length > 0
          ? h.response(rows[0])
          : h.response({ error: "Job run not found" }).code(404);
      },
    },

    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/activity-counts",
      options: bearerScope("read"),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const repo = `${request.params.owner}/${request.params.repo}`;

        return h.response({
          tasks: await countOrNull(
            pool,
            `SELECT count(*)::int as c FROM pipeline.tasks
              WHERE target_repo = $1 AND created_at >= now() - interval '7 days'`,
            [repo],
          ),
          auto_merged: await countOrNull(
            pool,
            `SELECT count(*)::int as c FROM pipeline.audit_log
              WHERE repo = $1
                AND event_type = 'auto_merge_decision'
                AND payload->>'outcome' = 'merged'
                AND created_at >= now() - interval '7 days'`,
            [repo],
          ),
          escalations: await countOrNull(
            pool,
            `SELECT count(*)::int as c FROM pipeline.audit_log
              WHERE repo = $1
                AND event_type = 'escalation_issued'
                AND created_at >= now() - interval '7 days'`,
            [repo],
          ),
        });
      },
    },
  ];
}
