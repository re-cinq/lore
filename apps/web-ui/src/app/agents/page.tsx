export const dynamic = "force-dynamic";
import {
  fetchAgentPresence,
  fetchAgentUsage,
  fetchDefinitionActivity,
  listOrgAgents,
} from "@/lib/agents-api";
import ScreenHeader from "@/components/ScreenHeader";
import AgentCards from "./AgentCards";
import styles from "./page.module.css";

const LEDE =
  "Every agent definition the organisation runs, grouped by the assembly line that dispatches it, with what each did on the floor in the last 30 days and a dot saying whether every cluster holds its latest version.";

export default async function AgentsPage() {
  const [definitions, usage, activity, presence] = await Promise.all([
    listOrgAgents(),
    fetchAgentUsage(),
    fetchDefinitionActivity(),
    fetchAgentPresence(),
  ]);

  return (
    <div>
      <ScreenHeader group="work" title="Agents" lede={LEDE} />
      <section className={styles.definitions}>
        <h2>Agent definitions</h2>
        <AgentCards
          agents={definitions}
          catalog={{ usage, activity, presence }}
        />
      </section>
    </div>
  );
}
