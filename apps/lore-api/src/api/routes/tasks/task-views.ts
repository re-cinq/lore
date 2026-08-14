import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { clampedLimit, DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * The task-shaped reads the dashboards need, moved out of web-ui (ADR-032).
 * Distinct from `/api/tasks`, which is the MCP's task LIST: these answer
 * per-screen questions — a repo's recent activity, the per-agent aggregates,
 * the org totals, one task's runtime trail, and the dark-factory audit feed.
 */

const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

const RepoTasksQuery = z.object({
  repo: z.string().min(1).max(200),
  limit: clampedLimit.default(15),
});

type RepoTasksQuery = z.infer<typeof RepoTasksQuery>;

const AgentActivityQuery = z.object({
  repo: z.string().max(200).optional(),
});

type AgentActivityQuery = z.infer<typeof AgentActivityQuery>;

const AuditLogQuery = z.object({
  repo: z.string().min(1).max(200),
  /** Comma-separated: the caller names the decision types its panel renders. */
  event_types: z.string().min(1).max(500),
  limit: clampedLimit.default(25),
});

type AuditLogQuery = z.infer<typeof AuditLogQuery>;

export function taskViewRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/repo-tasks",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(RepoTasksQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { repo, limit } = request.query as unknown as RepoTasksQuery;

        try {
          const { rows } = await pool.query(
            `SELECT id, description, task_type, status, agent_id, pr_url, created_at
               FROM pipeline.tasks
              WHERE target_repo = $1
              ORDER BY created_at DESC
              LIMIT $2`,
            [repo, limit],
          );

          return h.response({ tasks: rows });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ tasks: [] });
          }

          throw err;
        }
      },
    },

    {
      method: "GET",
      path: "/api/task-stats",
      options: bearerScope("read"),
      handler: async (_request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { rows } = await pool.query(
          `SELECT count(*)::int as total,
                  count(*) FILTER (WHERE created_at > current_date)::int as today
             FROM pipeline.tasks`,
        );

        return h.response(rows[0] ?? { total: 0, today: 0 });
      },
    },

    {
      method: "GET",
      path: "/api/agent-activity",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(AgentActivityQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { repo } = request.query as unknown as AgentActivityQuery;

        // The union is the screen's question: an agent that only ever wrote
        // memories (a developer's local MCP) never appears in pipeline.tasks,
        // and dropping it would hide exactly the agents a human recognises.
        // Cost joins llm_calls per task, so the aggregate stays SQL-side —
        // shipping every task and call to Node would move the whole pipeline
        // history over the wire for one dashboard row per agent.
        const { rows } = await pool.query(
          `WITH task_agents AS (
             SELECT t.agent_id,
                    count(DISTINCT t.id)::int              as task_count,
                    COALESCE(SUM(lc.cost_usd), 0)::float   as cost_usd,
                    string_agg(DISTINCT t.created_by, ', ') as created_by,
                    (array_agg(t.task_type ORDER BY t.created_at DESC))[1]  as reason_type,
                    (array_agg(t.description ORDER BY t.created_at DESC))[1] as reason,
                    max(t.created_at)                      as last_task_at
               FROM pipeline.tasks t
               LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
              WHERE t.agent_id IS NOT NULL
                ${repo ? "AND t.target_repo = $1" : ""}
              GROUP BY t.agent_id
           ),
           mem_agents AS (
             SELECT agent_id, count(*)::int as memory_count,
                    max(created_at) as last_memory_at
               FROM memory.memories
              WHERE is_deleted = FALSE
                ${repo ? "AND repo = $1" : ""}
              GROUP BY agent_id
           )
           SELECT COALESCE(ta.agent_id, ma.agent_id)           as agent_id,
                  COALESCE(ta.task_count, 0)                   as task_count,
                  COALESCE(ta.cost_usd, 0)                     as cost_usd,
                  ta.created_by,
                  ta.reason_type,
                  ta.reason,
                  COALESCE(ma.memory_count, 0)                 as memory_count,
                  GREATEST(ta.last_task_at, ma.last_memory_at) as last_active
             FROM task_agents ta
             FULL OUTER JOIN mem_agents ma ON ta.agent_id = ma.agent_id
            ORDER BY last_active DESC NULLS LAST`,
          repo ? [repo] : [],
        );

        return h.response({ agents: rows });
      },
    },

    {
      method: "GET",
      path: "/api/tasks/{id}/runtime",
      options: bearerScope("read"),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const taskId = request.params.id;

        const { rows: events } = await pool.query(
          `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
          [taskId],
        );
        const { rows: llmCalls } = await pool.query(
          `SELECT model, input_tokens, output_tokens, duration_ms, status, error, created_at
             FROM pipeline.llm_calls WHERE task_id = $1 ORDER BY created_at`,
          [taskId],
        );

        return h.response({ events, llm_calls: llmCalls });
      },
    },

    {
      method: "GET",
      path: "/api/audit-log",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(AuditLogQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { repo, event_types, limit } =
          request.query as unknown as AuditLogQuery;

        try {
          const { rows } = await pool.query(
            `SELECT event_type, payload, created_at FROM pipeline.audit_log
              WHERE repo = $1 AND event_type = ANY($2)
              ORDER BY created_at DESC LIMIT $3`,
            [repo, event_types.split(",").map((t) => t.trim()), limit],
          );

          return h.response({ entries: rows });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ entries: [] });
          }

          throw err;
        }
      },
    },
  ];
}
