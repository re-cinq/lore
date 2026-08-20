export const dynamic = "force-dynamic";
import Link from "next/link";
import { getAgentActivity } from "@/lib/api/tasks";
import { classifyAgent } from "@/lib/agent-classify";
import { listAgents } from "@/lib/agents-api";
import AgentsTable, { type AgentRow } from "@/components/AgentsTable";
import AgentList from "./AgentList";
import styles from "./agents.module.css";
import type { components } from "@/lib/api/schema";

/** The whole activity row, deliberately — this page renders every column the
 *  contract publishes, so there is nothing for a `Pick` to narrow. The global
 *  /agents page reads six of them and says so. */
type RepoAgentQueryRow =
  components["schemas"]["AgentActivity"]["agents"][number];

export default async function RepoAgents({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const agents = await listAgents(fullName);

  // Union task agents (pipeline tasks targeting this repo) with local MCP agents
  // (memories tagged with this repo) so a developer's own agent shows up here too.
  const result = await getAgentActivity(fullName);
  const rows = (result.status === "ok"
    ? result.data.agents
    : []) as unknown as RepoAgentQueryRow[];

  const activity: AgentRow[] = rows.map((r) => ({
    ...r,
    kind: classifyAgent(r),
  }));

  return (
    <div>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.headingGroup}>
            <h2 className={styles.sectionTitle}>Agent definitions</h2>
            <span className="count-pill">{agents.length}</span>
          </div>
          <Link href={`/repos/${owner}/${repo}/agents/new`}>
            <button>+ New definition</button>
          </Link>
        </div>
        <p className={styles.sectionDesc}>
          The model, timeout, prompt and execution image each task type runs
          from — config, not a run. Org defaults overlaid with this repo&apos;s
          overrides.
        </p>
        <AgentList base={`/repos/${owner}/${repo}`} agents={agents} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.headingGroup}>
            <h2 className={styles.sectionTitle}>Sessions</h2>
            <span className="count-pill">{activity.length}</span>
          </div>
        </div>
        <p className={styles.sectionDesc}>
          Developer Claude Code sessions and task runs that touched this repo,
          grouped by agent id. Local sessions show by default; ephemeral task
          runs stay behind the audit toggle.
        </p>
        <AgentsTable embedded agents={activity} />
      </section>
    </div>
  );
}
