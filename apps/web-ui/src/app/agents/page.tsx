export const dynamic = "force-dynamic";
import { getAgentActivity } from "@/lib/api/tasks";
import { classifyAgent } from "@/lib/agent-classify";
import AgentsTable, { type AgentRow } from "@/components/AgentsTable";
import type { components } from "@/lib/api/schema";

/** The activity row this page reads — six of the columns the contract publishes. */
type AgentQueryRow = Pick<
  components["schemas"]["AgentActivity"]["agents"][number],
  | "agent_id"
  | "task_count"
  | "cost_usd"
  | "created_by"
  | "memory_count"
  | "last_active"
>;

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
