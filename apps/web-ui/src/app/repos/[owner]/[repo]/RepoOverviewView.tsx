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
  trustLevel: string;
  tasksWeek: number;
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
      <ActivityCard {...props} />
      <RecentTasks owner={owner} repo={repo} recentTasks={recentTasks} />
      <LatestEvents owner={owner} repo={repo} latestEvents={latestEvents} />
    </div>
  );
}

type RepoLinkProps = Pick<RepoOverviewViewProps, "owner" | "repo">;

type ActivityProps = Pick<RepoOverviewViewProps, "trustLevel" | "tasksWeek">;

/** How far the repo is trusted and how many tasks the last seven days produced. */
function ActivityCard(props: ActivityProps & RepoLinkProps) {
  const { owner, repo, trustLevel, tasksWeek } = props;

  return (
    <div className={`spec-card ${styles.activityCard}`}>
      <div className={styles.activityHead}>
        <h3 className={styles.activityTitle}>Activity</h3>
        <Link href={`/repos/${owner}/${repo}/settings`} className="meta">
          configure →
        </Link>
      </div>
      <div className={styles.stats}>
        <Stat label="Trust" value={trustLevel} />
        <Stat label="Tasks (7d)" value={tasksWeek} />
      </div>
    </div>
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

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className={`meta ${styles.statLabel}`}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
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
