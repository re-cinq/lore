import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { selectList } from "@re-cinq/lore-shared/lib/row.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  RepoTasksQuery,
  AgentActivityQuery,
  AuditLogQuery,
  REPO_TASK_COLUMNS,
  RepoTaskListSchema,
  TaskStatsSchema,
  AgentActivitySchema,
  TASK_RUNTIME_LLM_COLUMNS,
  TaskRuntimeSchema,
  AuditLogPageSchema,
} from "./task-views-schemas.js";
import { TASK_EVENT_COLUMNS } from "@re-cinq/lore-shared/models/task-event.js";

// Task-shaped reads dashboards need (ADR-032), distinct from `/api/tasks` (the MCP's task LIST) — these answer per-screen questions.

const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

export function taskViewRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    repoTasksRoute(getPool),
    taskStatsRoute(getPool),
    agentActivityRoute(getPool),
    taskRuntimeRoute(getPool),
    auditLogRoute(getPool),
  ];
}

function repoTasksRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repo-tasks",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(RepoTasksQuery) },
      },
      RepoTaskListSchema,
      { name: "RepoTaskList", description: "A repo's recent tasks" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { repo, limit } = request.query as unknown as RepoTasksQuery;

      try {
        const { rows } = await pool.query(
          `SELECT ${selectList(REPO_TASK_COLUMNS)}
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
  };
}

function taskStatsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/task-stats",
    options: zodResponse(bearerScope("read"), TaskStatsSchema, {
      name: "TaskStats",
      description: "Pipeline task counts",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { rows } = await pool.query(
        `SELECT count(*)::int as total,
                count(*) FILTER (WHERE created_at > current_date)::int as today
           FROM pipeline.tasks`,
      );

      return h.response(rows[0] ?? { total: 0, today: 0 });
    },
  };
}

function agentActivityRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-activity",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(AgentActivityQuery) },
      },
      AgentActivitySchema,
      { name: "AgentActivity", description: "Per-agent activity roll-up" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { repo } = request.query as unknown as AgentActivityQuery;

      // The union is the point: an agent that only wrote memories never appears in pipeline.tasks; the cost aggregate stays SQL-side rather than shipping the whole pipeline history to Node per row.
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
  };
}

function taskRuntimeRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks/{id}/runtime",
    options: zodResponse(bearerScope("read"), TaskRuntimeSchema, {
      name: "TaskRuntime",
      description: "A task's transitions and LLM calls",
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const taskId = request.params.id;

      const { rows: events } = await pool.query(
        `SELECT ${selectList(TASK_EVENT_COLUMNS)}
           FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
        [taskId],
      );
      const { rows: llmCalls } = await pool.query(
        `SELECT ${selectList(TASK_RUNTIME_LLM_COLUMNS)}
           FROM pipeline.llm_calls WHERE task_id = $1 ORDER BY created_at`,
        [taskId],
      );

      return h.response({ events, llm_calls: llmCalls });
    },
  };
}

function auditLogRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/audit-log",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(AuditLogQuery) },
      },
      AuditLogPageSchema,
      {
        name: "AuditLogPage",
        description: "Recent audit entries for a repo",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
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
  };
}
