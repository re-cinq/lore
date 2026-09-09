import type { ReactNode } from "react";
import { Alert } from "@/components/Alert";
import Link from "next/link";
import ReadmeBox from "./ReadmeBox";
import EnrollmentSection from "@/components/EnrollmentSection";
import EventRow, { EventsTableHead } from "./events/EventRow";
import { type RepoEvent } from "./events/pagination";
import { type Check } from "@/lib/enrollment";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import styles from "./RepoOverviewView.module.css";
import DataTable from "@/components/DataTable";

export interface RepoReadme {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}

export interface RecentTask {
  id: string | number;
  description: string;
  status: string;
  agent_id?: string | null;
  pr_url?: string | null;
  created_at: string | Date;
}

export interface RepoOverviewViewProps {
  owner: string;
  repo: string;
  readme: RepoReadme | null;
  enrollmentChecks: Check[];
  darkFactoryEnabled: boolean;
  trustLevel: string;
  darkTasksWeek: number;
  autoMergedWeek: number;
  escalationsWeek: number;
  recentTasks: RecentTask[];
  /** The 10 most recent event-bus rows for this repo (newest first). */
  latestEvents: RepoEvent[];
  /** Server action wired to the enrollment re-onboard button ("actions up"). */
  reonboardAction: () => Promise<void>;
  /** Server action wired to the enrollment webhook "set up" button. */
  setupWebhookAction: () => Promise<void>;
}

/** Repo overview: pure render with reonboardAction callback (no data access). */
export default function RepoOverviewView(props: RepoOverviewViewProps) {
  const { owner, repo, readme, enrollmentChecks } = props;
  const { reonboardAction, setupWebhookAction } = props;
  const { recentTasks, latestEvents } = props;

  return (
    <div>
      {readme && <ReadmeBox {...readme} />}
      <EnrollmentSection
        checks={enrollmentChecks}
        reonboardAction={reonboardAction}
        setupWebhookAction={setupWebhookAction}
      />
      <DarkFactoryCard {...props} />
      <RecentTasks owner={owner} repo={repo} recentTasks={recentTasks} />
      <LatestEvents owner={owner} repo={repo} latestEvents={latestEvents} />
    </div>
  );
}

type RepoLinkProps = Pick<RepoOverviewViewProps, "owner" | "repo">;

type DarkFactoryStatsProps = Pick<
  RepoOverviewViewProps,
  | "darkFactoryEnabled"
  | "trustLevel"
  | "darkTasksWeek"
  | "autoMergedWeek"
  | "escalationsWeek"
>;

/** A tone only when the figure is non-zero, so a quiet week reads as quiet rather than as good or bad news. */
function tonedWhenNonZero(count: number, tone: string): string | undefined {
  return count > 0 ? tone : undefined;
}

/** Whether the repo runs dark. "Off (legacy)" rather than a bare "Off": every repo predates the mode, so off is the inherited state, not a choice someone made. */
function ModeValue({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className={styles.success}>Enabled</span>
  ) : (
    <span className="meta">Off (legacy)</span>
  );
}

/** Auto-merges are toned as success and escalations as danger only when NON-ZERO, so a quiet week reads as quiet rather than as good or bad news. */
function WeeklyOutcomeStats(props: DarkFactoryStatsProps) {
  const { autoMergedWeek, escalationsWeek } = props;

  return (
    <>
      <Stat
        label="Auto-merged (7d)"
        value={autoMergedWeek}
        tone={tonedWhenNonZero(autoMergedWeek, styles.success)}
      />
      <Stat
        label="Escalations (7d)"
        value={escalationsWeek}
        tone={tonedWhenNonZero(escalationsWeek, styles.danger)}
      />
    </>
  );
}

/** The week's dark-factory figures. */
function DarkFactoryStats(props: DarkFactoryStatsProps) {
  const { darkFactoryEnabled, trustLevel, darkTasksWeek } = props;

  return (
    <div className={styles.stats}>
      <Stat label="Mode" value={<ModeValue enabled={darkFactoryEnabled} />} />
      <Stat label="Trust" value={trustLevel} />
      <Stat label="Tasks (7d)" value={darkTasksWeek} />
      <WeeklyOutcomeStats {...props} />
    </div>
  );
}

/** The repo's dark-factory posture at a glance: whether it is on, how far it is trusted, and what the last seven days produced. */
function DarkFactoryCard(props: DarkFactoryStatsProps & RepoLinkProps) {
  const { owner, repo } = props;

  return (
    <div className={`spec-card ${styles.dfCard}`}>
      <div className={styles.dfHead}>
        <h3 className={styles.dfTitle}>Dark Factory</h3>
        <Link href={`/repos/${owner}/${repo}/settings`} className="meta">
          configure →
        </Link>
      </div>
      <DarkFactoryStats {...props} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div>
      <div className={`meta ${styles.statLabel}`}>{label}</div>
      <div className={tone ? `${styles.statValue} ${tone}` : styles.statValue}>
        {value}
      </div>
    </div>
  );
}

/** One task row. The description is truncated because this table is a glance at what the repo has been doing — the task page is where a description is read in full. */
function taskCells(task: RepoOverviewViewProps["recentTasks"][number]) {
  return [
    <Link href={`/tasks/${task.id}`} key="task">
      {task.description.substring(0, 60)}...
    </Link>,
    <span className={`op-badge op-${task.status}`} key="status">
      {formatEnumLabel(task.status)}
    </span>,
    task.pr_url ? (
      <a href={task.pr_url} target="_blank" key="pr">
        PR
      </a>
    ) : (
      "—"
    ),
    <span className="meta" key="created">
      <TimeAgo date={task.created_at} />
    </span>,
  ];
}

// No table at all when there are no tasks — an empty grid says less than the invitation to create one.
function CreateFirstTaskPrompt({ owner, repo }: RepoLinkProps) {
  return (
    <>
      <h2>Recent Tasks</h2>
      <Alert variant="secondary">
        No tasks yet.{" "}
        <Link href={`/repos/${owner}/${repo}/tasks`}>Create one</Link>
      </Alert>
    </>
  );
}

type RecentTasksProps = RepoLinkProps &
  Pick<RepoOverviewViewProps, "recentTasks">;

function RecentTasks({ owner, repo, recentTasks }: RecentTasksProps) {
  if (recentTasks.length === 0) {
    return <CreateFirstTaskPrompt owner={owner} repo={repo} />;
  }

  return (
    <DataTable
      title="Recent Tasks"
      columns={["Task", "Status", "PR", "Created"]}
      rows={recentTasks}
      rowKey={(t) => String(t.id)}
      cells={taskCells}
    />
  );
}

/** The most recent events, or a note that there are none. */
function EventsTable({
  events,
}: {
  events: RepoOverviewViewProps["latestEvents"];
}) {
  if (events.length === 0) {
    return <Alert variant="secondary">No events yet.</Alert>;
  }

  return (
    <table>
      <EventsTableHead />
      <tbody>
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </tbody>
    </table>
  );
}

function LatestEvents({
  owner,
  repo,
  latestEvents,
}: Pick<RepoOverviewViewProps, "owner" | "repo" | "latestEvents">) {
  return (
    <>
      <div className={styles.eventsHead}>
        <h2 className={styles.eventsTitle}>Latest Events</h2>
        <Link href={`/repos/${owner}/${repo}/events`} className="meta">
          Show all →
        </Link>
      </div>
      <EventsTable events={latestEvents} />
    </>
  );
}
