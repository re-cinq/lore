import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import { ToolDeps } from "./deps.js";

export function registerUsageTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "lore_my_usage",
    `Reports the calling agent's own task count and input/output token totals across three windows (today, 7_day, 30_day); returns { agent_id, usage: { today, 7_day, 30_day } } (DB-only). Instead: for org-wide throughput, success rates, and per-type breakdown use lore_get_analytics — this tool is single-agent only and does not report success rates or per-type counts.`,
    {
      agent_id: z
        .string()
        .optional()
        .describe(
          "Agent identifier (email or UUID). Auto-detected from caller when omitted. Pass only to inspect a different agent.",
        ),
    },
    async ({ agent_id }) => {
      try {
        const dbPoolRef = getPool();

        if (!dbPoolRef) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Usage tracking requires PostgreSQL (LORE_DB_HOST not set).",
              },
            ],
          };
        }
        const agent = resolveAgentId(agent_id);
        const periods = [
          { name: "today", filter: "t.created_at > current_date" },
          {
            name: "7_day",
            filter: "t.created_at > current_date - interval '7 days'",
          },
          {
            name: "30_day",
            filter: "t.created_at > current_date - interval '30 days'",
          },
        ];
        const results: any = {};

        for (const period of periods) {
          const { rows } = await dbPoolRef.query(
            `SELECT COUNT(DISTINCT t.id)::int as tasks,
                    COALESCE(SUM(lc.input_tokens), 0)::bigint as input_tokens,
                    COALESCE(SUM(lc.output_tokens), 0)::bigint as output_tokens
             FROM pipeline.tasks t
             LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
             WHERE (t.created_by = $1 OR t.created_by LIKE $2 OR t.agent_id = $1)
               AND ${period.filter}`,
            [agent, `%${agent.substring(0, 8)}%`],
          );

          results[period.name] = {
            tasks: rows[0].tasks,
            input_tokens: Number(rows[0].input_tokens),
            output_tokens: Number(rows[0].output_tokens),
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { agent_id: agent, usage: results },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        };
      }
    },
  );

  server.tool(
    "lore_get_analytics",
    `Returns org-wide pipeline analytics for a time window: { period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type } (DB-only). Note: by_type[].tasks is a numeric string (raw pg bigint). Instead: for a single agent's own footprint use lore_my_usage — this tool is not per-agent and does not filter by caller.`,
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("month")
        .describe('"today", "week", "month", or "all" (no time filter).'),
    },
    async ({ period }) => {
      try {
        const dbPoolRef = getPool();

        if (!process.env.LORE_DB_HOST) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Analytics requires PostgreSQL (LORE_DB_HOST not set).",
              },
            ],
          };
        }

        const periodFilter = {
          today: "created_at > current_date",
          week: "created_at > date_trunc('week', current_date)",
          month: "created_at > date_trunc('month', current_date)",
          all: "TRUE",
        }[period];

        const [usageResult, taskResult, byTypeResult] = await Promise.all([
          dbPoolRef.query(
            `SELECT count(*) as calls, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM pipeline.llm_calls WHERE ${periodFilter}`,
          ),
          dbPoolRef.query(
            `SELECT count(*) as total, count(*) FILTER (WHERE status IN ('pr-created', 'merged')) as succeeded, count(*) FILTER (WHERE status = 'failed') as failed FROM pipeline.tasks WHERE ${periodFilter}`,
          ),
          dbPoolRef.query(
            `SELECT t.task_type, count(DISTINCT t.id) as tasks FROM pipeline.tasks t WHERE ${periodFilter} GROUP BY t.task_type ORDER BY tasks DESC`,
          ),
        ]);

        const analytics = {
          period,
          usage: {
            llm_calls: parseInt(usageResult.rows[0].calls),
            input_tokens: parseInt(usageResult.rows[0].input_tokens),
            output_tokens: parseInt(usageResult.rows[0].output_tokens),
          },
          tasks: {
            total: parseInt(taskResult.rows[0].total),
            succeeded: parseInt(taskResult.rows[0].succeeded),
            failed: parseInt(taskResult.rows[0].failed),
          },
          by_type: byTypeResult.rows,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(analytics, null, 2) },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching analytics: ${err.message}`,
            },
          ],
        };
      }
    },
  );
}
