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

interface DefinitionsSectionProps {
  owner: string;
  repo: string;
  agents: Awaited<ReturnType<typeof listAgents>>;
  usage: Awaited<ReturnType<typeof fetchAgentUsage>>;
}

/** The recipes each task type runs FROM — config, not a run — which is the distinction the Sessions section below it depends on. Org defaults are shown already overlaid with this repo's overrides, so what is listed is what a dispatch will actually resolve. */
async function DefinitionsSection({
  owner,
  repo,
  agents,
  usage,
}: DefinitionsSectionProps) {
  return (
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
        The model, timeout, prompt and execution image each task type runs from
        — config, not a run. Org defaults overlaid with this repo&apos;s
        overrides.
      </p>
      <AgentList
        base={`/repos/${owner}/${repo}`}
        agents={agents}
        usage={usage}
      />
    </section>
  );
}

/** Task agents and local MCP agents together, so a developer's own session shows up beside the runs it started. An unreachable endpoint yields an empty list rather than an error — the definitions above are still worth showing. */
async function repoActivity(fullName: string): Promise<AgentRow[]> {
  const result = await getAgentActivity(fullName);
  const rows = (result.status === "ok"
    ? result.data.agents
    : []) as unknown as RepoAgentQueryRow[];

  return rows.map((r) => ({ ...r, kind: classifyAgent(r) }));
}

/** Who actually ran, as opposed to what could run. Ephemeral per-task agents stay behind the audit toggle so the list reads as people rather than as runs. */
function SessionsSection({ activity }: { activity: AgentRow[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.headingGroup}>
          <h2 className={styles.sectionTitle}>Sessions</h2>
          <span className="count-pill">{activity.length}</span>
        </div>
      </div>
      <p className={styles.sectionDesc}>
        Developer Claude Code sessions and task runs that touched this repo,
        grouped by agent id. Local sessions show by default; ephemeral task runs
        stay behind the audit toggle.
      </p>
      <AgentsTable embedded agents={activity} />
    </section>
  );
}

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

  return (
    <div>
      <DefinitionsSection
        owner={owner}
        repo={repo}
        agents={agents}
        usage={usage}
      />
      <SessionsSection activity={await repoActivity(fullName)} />
    </div>
  );
}
