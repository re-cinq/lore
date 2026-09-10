import { type IngestWorkflowStatus } from "@/lib/ingest-workflow";
import type { FixWorkflowResult } from "@/lib/fix-workflow-result";
import FixIngestButton, {
  FixWorkflowButton,
} from "@/components/FixIngestButton";
import Icon from "@/components/Icon";
import Link from "next/link";
import styles from "./HomeView.module.css";
import type { components } from "@/lib/api/schema";

// A PICK over the published shape, not a copy — types still come from the contract.
export type Repo = Pick<
  components["schemas"]["RepoList"]["repos"][number],
  | "full_name"
  | "owner"
  | "name"
  | "team"
  | "onboarded_at"
  | "last_ingested_at"
  | "onboarding_pr_merged"
  | "task_count"
  | "active_agents"
>;

export interface HomeViewProps {
  repos: Repo[];
  ingestStatus: Map<string, IngestWorkflowStatus>;
  misaligned: string[];
  /** Overview action wired to the Fix-ingest button ("actions up"). */
  fixIngestWorkflows: (repos: string[]) => Promise<FixWorkflowResult>;
  impactMisaligned: string[];
  fixTraceImpactWorkflows: (repos: string[]) => Promise<FixWorkflowResult>;
}

// Pure render — repo list/status come from page.tsx; fixIngestWorkflows is the only mutation, fired via the client button.
export default function HomeView(props: HomeViewProps) {
  const { repos, ingestStatus } = props;

  return (
    <div>
      <DashboardHeader
        misaligned={props.misaligned}
        fixIngestWorkflows={props.fixIngestWorkflows}
        impactMisaligned={props.impactMisaligned}
        fixTraceImpactWorkflows={props.fixTraceImpactWorkflows}
      />
      <RepoGrid repos={repos} ingestStatus={ingestStatus} />
    </div>
  );
}

type DashboardHeaderProps = Pick<
  HomeViewProps,
  | "misaligned"
  | "fixIngestWorkflows"
  | "impactMisaligned"
  | "fixTraceImpactWorkflows"
>;

/** The title and the three things a reader can do from the dashboard. The two fix buttons hide themselves when nothing is misaligned, so this row is usually just "Add Repo". */
function DashboardHeader(props: DashboardHeaderProps) {
  return (
    <div className={styles.header}>
      <h1>Repositories</h1>
      <div className={styles.headerActions}>
        <FixIngestButton
          repos={props.misaligned}
          action={props.fixIngestWorkflows}
        />
        <FixImpactButton
          repos={props.impactMisaligned}
          action={props.fixTraceImpactWorkflows}
        />
        <Link href="/onboard">
          <button>+ Add Repo</button>
        </Link>
      </div>
    </div>
  );
}

/** Opens the PR that installs the current spec-impact workflow. The title spells out the consequence of NOT fixing it: a repo on an old workflow has its impact findings suppressed rather than reported. */
function FixImpactButton({
  repos,
  action,
}: {
  repos: React.ComponentProps<typeof FixWorkflowButton>["repos"];
  action: React.ComponentProps<typeof FixWorkflowButton>["action"];
}) {
  return (
    <FixWorkflowButton
      repos={repos}
      action={action}
      label="Fix spec-impact workflow"
      title="Open a PR installing the latest .github/workflows/lore-trace-impact.yml. Until it lands, this repo's impact findings are suppressed."
    />
  );
}

/** The grid itself, and the one place that knows an empty list is an onboarding prompt rather than a card. */
function RepoGrid({
  repos,
  ingestStatus,
}: Pick<HomeViewProps, "repos" | "ingestStatus">) {
  return (
    <div className="repo-grid">
      {repos.map((r) => (
        <RepoCard
          key={r.full_name}
          repo={r}
          ingest={ingestStatus.get(r.full_name)}
        />
      ))}
      {repos.length === 0 && <EmptyRepos />}
    </div>
  );
}

interface RepoCardProps {
  repo: HomeViewProps["repos"][number];
  ingest: ReturnType<HomeViewProps["ingestStatus"]["get"]>;
}

/** One repo's card. The freshness dot and the ingest badge are the two things a reader scans for — everything else on the card is context for them. */
function RepoCard({ repo: r, ingest }: RepoCardProps) {
  return (
    <Link href={`/repos/${r.owner}/${r.name}`} className="repo-card">
      <h3 className={styles.cardTitle}>
        <FreshnessDot lastIngestedAt={r.last_ingested_at} />
        {r.full_name}
      </h3>
      <div className="repo-meta">
        {r.team && <span className="badge">{r.team}</span>}
        <span className="meta">{r.task_count} tasks</span>
        {r.active_agents > 0 && (
          <span className="badge badge-green">{r.active_agents} running</span>
        )}
        <IngestBadge ingest={ingest} />
      </div>
      <div className="meta">{ingestionSummary(r)}</div>
    </Link>
  );
}

/** A first run, not a failure. Points at onboarding rather than reporting an empty list, because there is exactly one thing to do from here. */
function EmptyRepos() {
  return (
    <div className="placeholder">
      <p>No repositories onboarded yet.</p>
      <p>
        <Link href="/onboard">Add your first repo</Link> to get started.
      </p>
    </div>
  );
}

/** How recently this repo was ingested, as a colour. A dot rather than a date because it is scanned across a grid: the reader is looking for the stale one, not reading each timestamp. */
function FreshnessDot({ lastIngestedAt }: { lastIngestedAt: string | null }) {
  const indicator = freshnessIndicator(lastIngestedAt);

  return (
    <span
      title={indicator.label}
      className={styles.freshnessDot}
      style={{ ["--dot-color" as string]: indicator.color }}
    />
  );
}

/** Present only when the repo's ingest workflow needs attention. The title says it is fixable from this page, because the badge is otherwise a report with no next step. */
function IngestBadge({
  ingest,
}: {
  ingest: ReturnType<HomeViewProps["ingestStatus"]["get"]>;
}) {
  const badge = ingestBadge(ingest);

  if (!badge) {
    return null;
  }

  return (
    <span
      className={`badge ${styles.ingestBadge}`}
      title={`${badge.label} — fixable from the dashboard`}
      style={{ ["--badge-color" as string]: badge.color }}
    >
      <Icon name="warning" size={12} inline /> {badge.label}
    </span>
  );
}

function ingestionSummary(repo: Repo): string {
  if (repo.last_ingested_at) {
    return `Last ingested ${new Date(repo.last_ingested_at).toLocaleDateString()}`;
  }

  if (repo.onboarding_pr_merged) {
    return "Onboarded, awaiting ingestion";
  }

  return "Onboarding PR pending";
}

function freshnessIndicator(lastIngestedAt: string | null): {
  color: string;
  label: string;
} {
  if (!lastIngestedAt) {
    return { color: "var(--text-muted)", label: "Never ingested" };
  }
  const now = new Date();
  const ingested = new Date(lastIngestedAt);
  const hoursAgo = (now.getTime() - ingested.getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 24) {
    return { color: "var(--success)", label: "Fresh (< 24h)" };
  }

  if (hoursAgo < 7 * 24) {
    return { color: "var(--warning)", label: "Stale (< 7d)" };
  }

  return { color: "var(--danger)", label: "Outdated (> 7d)" };
}

function ingestBadge(
  status: IngestWorkflowStatus | undefined,
): { label: string; color: string } | null {
  if (status === "missing") {
    return { label: "no ingest workflow", color: "var(--danger)" };
  }

  if (status === "stale") {
    return { label: "ingest workflow outdated", color: "var(--warning)" };
  }

  return null;
}
