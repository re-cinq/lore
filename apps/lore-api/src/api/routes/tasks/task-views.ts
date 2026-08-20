import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { selectList, pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import {
  TaskEventSchema,
  TASK_EVENT_COLUMNS,
} from "@re-cinq/lore-shared/models/task-event.js";
import {
  LlmCallSchema,
  LLM_CALL_COLUMNS,
} from "@re-cinq/lore-shared/models/llm-call.js";
import {
  AuditLogEntrySchema,
  AUDIT_LOG_ENTRY_COLUMNS,
} from "@re-cinq/lore-shared/models/audit-log-entry.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
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

/**
 * The task dashboard's read models. Stored fields come from the models; the
 * aggregates (counts, summed cost, the agent roll-up) are computed per query and
 * belong to no table, so they are stated here.
 */
const REPO_TASK_FIELDS = [
  "id",
  "description",
  "taskType",
  "status",
  "agentId",
  "prUrl",
  "createdAt",
] as const;
const REPO_TASK_COLUMNS = pickColumns(PIPELINE_TASK_COLUMNS, REPO_TASK_FIELDS);

const RepoTaskListSchema = z.object({
  tasks: z.array(
    wireSchema(
      PipelineTaskSchema.pick({
        id: true,
        description: true,
        taskType: true,
        status: true,
        agentId: true,
        prUrl: true,
        createdAt: true,
      }),
      PIPELINE_TASK_COLUMNS,
    ),
  ),
});

const TaskStatsSchema = z.object({ total: z.number(), today: z.number() });

/** One row per agent, unioned across tasks and memories. */
const AgentActivitySchema = z.object({
  agents: z.array(
    z.object({
      agent_id: z.string().nullable(),
      task_count: z.number(),
      cost_usd: z.number(),
      created_by: z.string().nullable(),
      reason_type: z.string().nullable(),
      reason: z.string().nullable(),
      memory_count: z.number(),
      last_active: z.string().nullable(),
    }),
  ),
});

const TASK_RUNTIME_LLM_FIELDS = [
  "model",
  "inputTokens",
  "outputTokens",
  "durationMs",
  "status",
  "error",
  "createdAt",
] as const;
const TASK_RUNTIME_LLM_COLUMNS = pickColumns(
  LLM_CALL_COLUMNS,
  TASK_RUNTIME_LLM_FIELDS,
);

const TaskRuntimeSchema = z.object({
  events: z.array(wireSchema(TaskEventSchema, TASK_EVENT_COLUMNS)),
  llm_calls: z.array(
    wireSchema(
      LlmCallSchema.pick({
        model: true,
        inputTokens: true,
        outputTokens: true,
        durationMs: true,
        status: true,
        error: true,
        createdAt: true,
      }),
      LLM_CALL_COLUMNS,
    ),
  ),
});

const AuditLogPageSchema = z.object({
  entries: z.array(
    wireSchema(
      AuditLogEntrySchema.pick({
        eventType: true,
        payload: true,
        createdAt: true,
      }),
      AUDIT_LOG_ENTRY_COLUMNS,
    ),
  ),
});

export function taskViewRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
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

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
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
    },

    {
      method: "GET",
      path: "/api/task-stats",
      options: zodResponse(bearerScope("read"), TaskStatsSchema, {
        name: "TaskStats",
        description: "Pipeline task counts",
      }),
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
      options: zodResponse(bearerScope("read"), TaskRuntimeSchema, {
        name: "TaskRuntime",
        description: "A task's transitions and LLM calls",
      }),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
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
    },

    {
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
