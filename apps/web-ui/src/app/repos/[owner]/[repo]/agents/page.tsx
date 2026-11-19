export const dynamic = "force-dynamic";
import Link from "next/link";
import { getRepo } from "@/lib/api/repos";
import { getAgentActivity } from "@/lib/api/tasks";
import { classifyAgent } from "@/lib/agent-classify";
import { fetchAgentUsage, listAgents, listOrgAgents } from "@/lib/agents-api";
import AgentsTable, { type AgentRow } from "@/components/AgentsTable";
import { SubmitButton } from "@/components/SubmitButton";
import AgentList from "./AgentList";
import BaseImageSelector from "./BaseImageSelector";
import { removeAgentOverrideAction, saveBaseImageAction } from "./actions";
import styles from "./agents.module.css";
import type { components } from "@/lib/api/schema";

/** Whole activity row; page renders every contract column (global /agents reads six). */
type RepoAgentQueryRow =
  components["schemas"]["AgentActivity"]["agents"][number];

interface DefinitionsSectionProps {
  fullName: string;
  agents: Awaited<ReturnType<typeof listAgents>>;
  baseImage: string | null;
  orgImages: Record<string, string | null>;
  usage: Awaited<ReturnType<typeof fetchAgentUsage>>;
}

export default async function RepoAgents({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const definitions = await loadDefinitionsData(fullName);

  return (
    <div>
      <DefinitionsSection {...definitions} />
      <SessionsSection activity={await repoActivity(fullName)} />
    </div>
  );
}

async function loadDefinitionsData(
  fullName: string,
): Promise<DefinitionsSectionProps> {
  const [agents, orgAgents, usage, baseImage] = await Promise.all([
    listAgents(fullName),
    listOrgAgents(),
    fetchAgentUsage(),
    repoBaseImage(fullName),
  ]);
  const orgImages = Object.fromEntries(
    orgAgents.map((agent) => [agent.name, agent.image]),
  );

  return { fullName, agents, baseImage, orgImages, usage };
}

/** The recipes each task type runs FROM — config, not a run — which is the distinction the Sessions section below it depends on. Org defaults are shown already overlaid with this repo's overrides, so what is listed is what a dispatch will actually resolve. */
function DefinitionsSection(props: DefinitionsSectionProps) {
  const { fullName, agents, baseImage, orgImages, usage } = props;

  return (
    <section className={styles.section}>
      <DefinitionsHead fullName={fullName} count={agents.length} />
      <DefinitionsIntro fullName={fullName} baseImage={baseImage} />
      <AgentList
        base={`/repos/${fullName}`}
        agents={agents}
        baseImage={baseImage}
        orgImages={orgImages}
        usage={usage}
        remove={removeAgentOverrideAction.bind(null, fullName)}
      />
    </section>
  );
}

function DefinitionsIntro({
  fullName,
  baseImage,
}: {
  fullName: string;
  baseImage: string | null;
}) {
  return (
    <>
      <p className={styles.sectionDesc}>
        The model, timeout, prompt and execution image each task type runs from
        — config, not a run. Org defaults overlaid with this repo&apos;s
        overrides.
      </p>
      <BaseImageControl fullName={fullName} baseImage={baseImage} />
    </>
  );
}

function BaseImageControl({
  fullName,
  baseImage,
}: {
  fullName: string;
  baseImage: string | null;
}) {
  return (
    <form
      action={saveBaseImageAction.bind(null, fullName)}
      className={styles.baseImageForm}
    >
      <label htmlFor="setting-base_image">Base Execution Image</label>
      <BaseImageSelector value={baseImage} />
      <SubmitButton className="btn-secondary" pendingLabel="Saving…">
        Save base image
      </SubmitButton>
    </form>
  );
}

async function repoBaseImage(fullName: string): Promise<string | null> {
  const result = await getRepo(fullName);

  if (result.status !== "ok") {
    return null;
  }

  const baseImage = (result.data.settings as { base_image?: unknown } | null)
    ?.base_image;

  return typeof baseImage === "string" && baseImage ? baseImage : null;
}

/** The section's own heading, count and the one action it offers. */
function DefinitionsHead({
  fullName,
  count,
}: {
  fullName: string;
  count: number;
}) {
  return (
    <div className={styles.sectionHead}>
      <div className={styles.headingGroup}>
        <h2 className={styles.sectionTitle}>Agent definitions</h2>
        <span className="count-pill">{count}</span>
      </div>
      <Link href={`/repos/${fullName}/agents/new`}>
        <button>+ New definition</button>
      </Link>
    </div>
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
