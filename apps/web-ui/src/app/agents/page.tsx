export const dynamic = "force-dynamic";
import { getAgentActivity } from "@/lib/api/tasks";
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
  const result = await getAgentActivity();
  const rows = (result.status === "ok"
    ? result.data.agents
    : []) as unknown as AgentQueryRow[];

  const agents: AgentRow[] = rows.map((row) => ({
    ...row,
    kind: classifyAgent(row),
  }));

  return (
    <AgentsTable
      agents={agents}
      intro="Every agent across the org. Local MCP agents (developers' own memory-writing agents) are shown by default; ephemeral task agents are hidden behind the toggle."
    />
  );
}
