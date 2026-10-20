export const dynamic = "force-dynamic";
import { getAgentActivity } from "@/lib/api/tasks";
import { classifyAgent } from "@/lib/agent-classify";
import { fetchAgentUsage, listOrgAgents } from "@/lib/agents-api";
import AgentsTable, { type AgentRow } from "@/components/AgentsTable";
import ScreenHeader from "@/components/ScreenHeader";
import AgentList from "../repos/[owner]/[repo]/agents/AgentList";
import styles from "./page.module.css";
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

const LEDE =
  "Local MCP agents are developers' own Claude Code sessions: they write memory and facts but never claim tasks. Task agents are ephemeral, one per station run, and kept for audit.";

export default async function AgentsPage() {
  const { agents, definitions, usage } = await loadAgentsPageData();

  return (
    <div>
      <ScreenHeader group="work" title="Agents" lede={LEDE} />
      <AgentsTable agents={agents} embedded />
      <section className={styles.definitions}>
        <h2>Agent definitions</h2>
        <AgentList base={null} agents={definitions} usage={usage} orgEditable />
      </section>
    </div>
  );
}

/** Union task agents (pipeline.tasks) with memory agents (memory.memories) so local-only MCP agents stay discoverable. */
async function loadAgentsPageData() {
  const [result, definitions, usage] = await Promise.all([
    getAgentActivity(),
    listOrgAgents(),
    fetchAgentUsage(),
  ]);
  const rows = (result.status === "ok"
    ? result.data.agents
    : []) as unknown as AgentQueryRow[];
  const agents: AgentRow[] = rows.map((row) => ({
    ...row,
    kind: classifyAgent(row),
  }));

  return { agents, definitions, usage };
}
