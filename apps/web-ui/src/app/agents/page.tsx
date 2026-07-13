export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import { classifyAgent } from "@/lib/agent-classify";
import AgentsTable, { type AgentRow } from "@/components/AgentsTable";

interface AgentQueryRow {
  agent_id: string;
  task_count: number;
  cost_usd: number;
  created_by: string | null;
  memory_count: number;
  last_active: string | null;
}

export default async function AgentsPage() {
  // Union task agents (pipeline.tasks) with memory agents (memory.memories) so
  // local MCP agents — which only ever write memories — are discoverable too.
  const rows = await query<AgentQueryRow>(`
    WITH task_agents AS (
      SELECT t.agent_id,
             count(DISTINCT t.id)::int              as task_count,
             COALESCE(SUM(lc.cost_usd), 0)::float   as cost_usd,
             string_agg(DISTINCT t.created_by, ', ') as created_by,
             max(t.created_at)                      as last_task_at
      FROM pipeline.tasks t
      LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
      WHERE t.agent_id IS NOT NULL
      GROUP BY t.agent_id
    ),
    mem_agents AS (
      SELECT agent_id, count(*)::int as memory_count, max(created_at) as last_memory_at
      FROM memory.memories
      WHERE is_deleted = FALSE
      GROUP BY agent_id
    )
    SELECT COALESCE(ta.agent_id, ma.agent_id)           as agent_id,
           COALESCE(ta.task_count, 0)                   as task_count,
           COALESCE(ta.cost_usd, 0)                     as cost_usd,
           ta.created_by,
           COALESCE(ma.memory_count, 0)                 as memory_count,
           GREATEST(ta.last_task_at, ma.last_memory_at) as last_active
    FROM task_agents ta
    FULL OUTER JOIN mem_agents ma ON ta.agent_id = ma.agent_id
    ORDER BY last_active DESC NULLS LAST
    LIMIT 200
  `);

  const agents: AgentRow[] = rows.map((r) => ({
    ...r,
    kind: classifyAgent(r),
  }));

  return (
    <AgentsTable
      agents={agents}
      intro="Every agent across the org. Local MCP agents (developers' own memory-writing agents) are shown by default; ephemeral task agents are hidden behind the toggle."
    />
  );
}
