import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveAgentId } from "../../platform/agent-id.js";
import { ToolDeps } from "./deps.js";

export function registerUsageTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "lore_my_usage",
    `Reports the CALLING agent's own footprint: distinct pipeline-task count plus summed input/output token totals, broken into three windows (today, 7_day, 30_day). Returns a JSON object { agent_id, usage: { today, 7_day, 30_day } } where each window is { tasks, input_tokens, output_tokens }; tokens come from pipeline.llm_calls joined to that agent's pipeline.tasks.
Use this for "how much have I personally run/spent lately". For an ORG-WIDE pulse across all agents (total throughput, success/fail rates, per-task-type breakdown) use lore_get_analytics instead — this tool is single-agent only and does NOT report success rates or per-type counts.
Runs against the shared backend Postgres directly and requires LORE_DB_HOST to be set; it does not proxy over LORE_API_URL. Read-only, no mutations. If the DB pool is unavailable it returns the text "Usage tracking requires PostgreSQL (LORE_DB_HOST not set)." rather than throwing.`,
    {
      agent_id: z
        .string()
        .optional()
        .describe(
          "Resolved agent identifier whose usage to report, e.g. \"loredana@re-cinq.com\" or a UUID. When omitted, auto-detected via resolveAgentId (explicit param then LORE_AGENT_ID env then ~/.lore/agent-id file then a generated UUID). Pass this only to inspect a different agent than the caller's own."
        ),
    },
    async ({ agent_id }) => {
      try {
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "Usage tracking requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const agent = resolveAgentId(agent_id);
        const periods = [
          { name: "today", filter: "t.created_at > current_date" },
          { name: "7_day", filter: "t.created_at > current_date - interval '7 days'" },
          { name: "30_day", filter: "t.created_at > current_date - interval '30 days'" },
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
        return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: agent, usage: results }, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_get_analytics",
    `Returns ORG-WIDE pipeline analytics for one fixed window: a JSON object { period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type: [{ task_type, tasks }] }. "succeeded" counts tasks with status pr-created or merged; "failed" counts status failed; usage aggregates all pipeline.llm_calls in the window; by_type breaks task counts down per task_type, busiest first. Note: usage.* and tasks.* counts are numbers, but by_type[].tasks comes back as a numeric STRING (raw pg bigint, not coerced).
Use this for a team-wide pulse (throughput, success rate, token spend, task-type mix) across ALL agents. For a SINGLE agent's own task/token footprint use lore_my_usage instead — this tool is not per-agent and does not filter by caller.
Runs against the shared backend Postgres directly and requires LORE_DB_HOST to be set; it does not proxy over LORE_API_URL. Read-only, no mutations. If LORE_DB_HOST is unset it returns the text "Analytics requires PostgreSQL (LORE_DB_HOST not set)." rather than throwing.`,
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("month")
        .describe(
          "Window for the created_at filter. One of: \"today\" (since current_date), \"week\" (since the start of the ISO week), \"month\" (since the start of the calendar month), \"all\" (no time filter, every record). Defaults to \"month\" when omitted. Example: \"week\"."
        ),
    },
    async ({ period }) => {
      try {
        const dbPoolRef = getPool();
        if (!process.env.LORE_DB_HOST) {
          return { content: [{ type: "text" as const, text: "Analytics requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }

        const periodFilter = {
          today: "created_at > current_date",
          week: "created_at > date_trunc('week', current_date)",
          month: "created_at > date_trunc('month', current_date)",
          all: "TRUE",
        }[period];

        const [usageResult, taskResult, byTypeResult] = await Promise.all([
          dbPoolRef.query(`SELECT count(*) as calls, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM pipeline.llm_calls WHERE ${periodFilter}`),
          dbPoolRef.query(`SELECT count(*) as total, count(*) FILTER (WHERE status IN ('pr-created', 'merged')) as succeeded, count(*) FILTER (WHERE status = 'failed') as failed FROM pipeline.tasks WHERE ${periodFilter}`),
          dbPoolRef.query(`SELECT t.task_type, count(DISTINCT t.id) as tasks FROM pipeline.tasks t WHERE t.${periodFilter} GROUP BY t.task_type ORDER BY tasks DESC`),
        ]);

        const analytics = {
          period,
          usage: { llm_calls: parseInt(usageResult.rows[0].calls), input_tokens: parseInt(usageResult.rows[0].input_tokens), output_tokens: parseInt(usageResult.rows[0].output_tokens) },
          tasks: { total: parseInt(taskResult.rows[0].total), succeeded: parseInt(taskResult.rows[0].succeeded), failed: parseInt(taskResult.rows[0].failed) },
          by_type: byTypeResult.rows,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(analytics, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error fetching analytics: ${err.message}` }] };
      }
    }
  );
}
