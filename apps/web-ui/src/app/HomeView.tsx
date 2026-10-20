import { type IngestWorkflowStatus } from "@/lib/ingest-workflow";
import type { FixWorkflowResult } from "@/lib/fix-workflow-result";
import FixIngestButton, {
  FixWorkflowButton,
} from "@/components/FixIngestButton";
import Icon from "@/components/Icon";
import Link from "next/link";
import styles from "./HomeView.module.css";
import type { components } from "@/lib/api/schema";
import {
  REPO_FILTERS,
  filterRepos,
  repoAttention,
  type Attention,
  type RepoFilter,
} from "./HomeView.filters";
import {
  freshnessIndicator,
  ingestAge,
} from "./repos/[owner]/[repo]/repo-freshness";

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
  /** The chip the reader picked (`?filter=`); every repo when absent. */
  filter?: RepoFilter;
}

// Pure render — repo list/status come from page.tsx; the fix buttons are the only mutations.
export default function HomeView(props: HomeViewProps) {
  const filter = props.filter ?? "all";
  const attention = attentionByRepo(props);

  return (
    <div className={styles.page}>
      <DashboardHeader {...props} attention={attention} />
      <FilterChips repos={props.repos} attention={attention} active={filter} />
      <RepoGrid
        repos={filterRepos(props.repos, filter, attention)}
        attention={attention}
        filtered={props.repos.length > 0}
      />
    </div>
  );
}

type AttentionMap = Map<string, Attention>;

/** Which repos need a fix, keyed by full name — counted by the header and the chips, drawn on the cards. */
function attentionByRepo(props: HomeViewProps): AttentionMap {
  const impact = new Set(props.impactMisaligned);
  const out: AttentionMap = new Map();

  for (const r of props.repos) {
    const found = repoAttention(r.full_name, props.ingestStatus, impact);

    if (found) {
      out.set(r.full_name, found);
    }
  }

  return out;
}

type DashboardHeaderProps = HomeViewProps & { attention: AttentionMap };

/** The title, the one-line summary, and the three things a reader can do. */
function DashboardHeader(props: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <div className={styles.eyebrow}>{"{work}"}</div>
        <h1 className={styles.title}>Repositories</h1>
        <p className={styles.summaryLine}>
          {summaryLine(props.repos, props.attention)}
        </p>
      </div>
      <HeaderActions {...props} />
    </header>
  );
}

/** The two fix buttons hide themselves when nothing is misaligned, so this row is usually just "Add repo". */
function HeaderActions(props: DashboardHeaderProps) {
  return (
    <div className={styles.headerActions}>
      <FixIngestButton
        repos={props.misaligned}
        action={props.fixIngestWorkflows}
      />
      <FixImpactButton
        repos={props.impactMisaligned}
        action={props.fixTraceImpactWorkflows}
      />
      <Link href="/onboard" className={styles.addRepo}>
        <Icon name="add" size={16} inline /> Add repo
      </Link>
    </div>
  );
}

function summaryLine(repos: Repo[], attention: AttentionMap): string {
  const running = repos.reduce((n, r) => n + r.active_agents, 0);

  return `${repos.length} onboarded · ${attention.size} need attention · ${running} agents running`;
}

/** Opens the PR that installs the current spec-impact workflow. The title spells out the consequence of NOT fixing it: a repo on an old workflow has its impact findings suppressed. */
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

interface FilterChipsProps {
  repos: Repo[];
  attention: AttentionMap;
  active: RepoFilter;
}

/** All / Needs attention / Agents running, as links: the filter lives in the URL, so it survives a reload and needs no client state. */
function FilterChips({ repos, attention, active }: FilterChipsProps) {
  return (
    <nav className={styles.chips} aria-label="Filter repositories">
      {REPO_FILTERS.map((f) => (
        <Link
          key={f.id}
          href={f.id === "all" ? "/" : `/?filter=${f.id}`}
          className={styles.chip}
          aria-current={f.id === active ? "page" : undefined}
        >
          {f.label}
          <span className={styles.chipCount}>
            {filterRepos(repos, f.id, attention).length}
          </span>
        </Link>
      ))}
    </nav>
  );
}

interface RepoGridProps {
  repos: Repo[];
  attention: AttentionMap;
  /** True when repos exist but the chip hid them all — not a first run. */
  filtered: boolean;
}

/** The grid itself, and the one place that knows an empty list is an onboarding prompt rather than a card. */
function RepoGrid({ repos, attention, filtered }: RepoGridProps) {
  if (repos.length === 0) {
    return filtered ? <FilterEmpty /> : <EmptyRepos />;
  }

  return (
    <div className={`repo-grid ${styles.grid}`}>
      {repos.map((r) => (
        <RepoCard
          key={r.full_name}
          repo={r}
          attention={attention.get(r.full_name)}
        />
      ))}
    </div>
  );
}

interface RepoCardProps {
  repo: Repo;
  attention: Attention | undefined;
}

/** One repo's card: who owns it, what it is doing, how fresh its context is, and — when there is one — the fix it needs. */
function RepoCard({ repo: r, attention }: RepoCardProps) {
  return (
    <Link
      href={`/repos/${r.owner}/${r.name}`}
      className={`repo-card ${styles.card}`}
    >
      <CardHead repo={r} />
      <CardStats repo={r} />
      {attention ? (
        <AttentionNote attention={attention} />
      ) : (
        <div className={styles.cardNote}>{ingestionSummary(r)}</div>
      )}
    </Link>
  );
}

function CardHead({ repo: r }: { repo: Repo }) {
  return (
    <div className={styles.cardHead}>
      <h3 className={styles.cardTitle}>
        <span className={styles.cardOwner}>{r.owner}/</span>
        <span className={styles.cardName}>{r.name}</span>
      </h3>
      {r.team && <span className={styles.team}>{r.team}</span>}
    </div>
  );
}

/** Tasks, running agents and ingest age — the three figures a reader compares across the grid. */
function CardStats({ repo: r }: { repo: Repo }) {
  return (
    <dl className={styles.stats}>
      <Stat label="Tasks" value={r.task_count} />
      <Stat
        label="Agents running"
        value={<RunningValue count={r.active_agents} />}
      />
      <Stat
        label="Last ingest"
        value={<IngestValue lastIngestedAt={r.last_ingested_at} />}
      />
    </dl>
  );
}

/** The running count, with a pulsing dot while any agent works. */
function RunningValue({ count }: { count: number }) {
  return (
    <>
      {count > 0 && (
        <span className={styles.runningDot} title={`${count} running`} />
      )}
      {count}
    </>
  );
}

function IngestValue({ lastIngestedAt }: { lastIngestedAt: string | null }) {
  return (
    <>
      <FreshnessDot lastIngestedAt={lastIngestedAt} />
      {ingestAge(lastIngestedAt)}
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.stat}>
      <dd className={styles.statValue}>{value}</dd>
      <dt className={styles.statLabel}>{label}</dt>
    </div>
  );
}

/** The fix a repo needs. The title says it is fixable from this page, because the note is otherwise a report with no next step. */
function AttentionNote({ attention }: { attention: Attention }) {
  return (
    <div
      className={styles.attention}
      data-tone={attention.tone}
      title={`${attention.label} — fixable from the dashboard`}
    >
      <Icon name="warning" size={14} inline /> {attention.label}
    </div>
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

function FilterEmpty() {
  return (
    <div className="placeholder">
      <p>No repositories match this filter.</p>
      <p>
        <Link href="/">Show all repositories</Link>
      </p>
    </div>
  );
}

/** How recently this repo was ingested, as a colour. A dot rather than a date because it is scanned across a grid: the reader is looking for the stale one. */
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

function ingestionSummary(repo: Repo): string {
  if (repo.last_ingested_at) {
    return `Last ingested ${new Date(repo.last_ingested_at).toLocaleDateString()}`;
  }

  if (repo.onboarding_pr_merged) {
    return "Onboarded, awaiting ingestion";
  }

  return "Onboarding PR pending";
}
