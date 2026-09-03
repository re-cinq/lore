export const dynamic = "force-dynamic";
import Link from "next/link";
import { getAgentActivity } from "@/lib/api/tasks";
import { classifyAgent } from "@/lib/agent-classify";
import { fetchAgentUsage, listAgents } from "@/lib/agents-api";
import AgentsTable, { type AgentRow } from "@/components/AgentsTable";
import AgentList from "./AgentList";
import styles from "./agents.module.css";
import type { components } from "@/lib/api/schema";

/** Whole activity row; page renders every contract column (global /agents reads six). */
type RepoAgentQueryRow =
  components["schemas"]["AgentActivity"]["agents"][number];

export default async function RepoAgents({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const [agents, usage] = await Promise.all([
    listAgents(fullName),
    fetchAgentUsage(),
  ]);

  // Union task agents + local MCP agents (tagged with repo) so developer's agent shows up.
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
        <AgentList
          base={`/repos/${owner}/${repo}`}
          agents={agents}
          usage={usage}
        />
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
