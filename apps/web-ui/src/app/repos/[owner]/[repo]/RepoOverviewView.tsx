import type { ReactNode } from "react";
import { Alert } from "@/components/Alert";
import Link from "next/link";
import ReadmeBox from "./ReadmeBox";
import EnrollmentSection from "@/components/EnrollmentSection";
import EventRow from "./events/EventRow";
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
export default function RepoOverviewView({
  owner,
  repo,
  readme,
  enrollmentChecks,
  darkFactoryEnabled,
  trustLevel,
  darkTasksWeek,
  autoMergedWeek,
  escalationsWeek,
  recentTasks,
  latestEvents,
  reonboardAction,
  setupWebhookAction,
}: RepoOverviewViewProps) {
  return (
    <div>
      {readme && (
        <ReadmeBox
          markdown={readme.markdown}
          rawBaseUrl={readme.rawBaseUrl}
          htmlUrl={readme.htmlUrl}
        />
      )}
      <EnrollmentSection
        checks={enrollmentChecks}
        reonboardAction={reonboardAction}
        setupWebhookAction={setupWebhookAction}
      />
      <DarkFactoryCard
        owner={owner}
        repo={repo}
        darkFactoryEnabled={darkFactoryEnabled}
        trustLevel={trustLevel}
        darkTasksWeek={darkTasksWeek}
        autoMergedWeek={autoMergedWeek}
        escalationsWeek={escalationsWeek}
      />
      <RecentTasks owner={owner} repo={repo} recentTasks={recentTasks} />
      <LatestEvents owner={owner} repo={repo} latestEvents={latestEvents} />
    </div>
  );
}

/** The repo's dark-factory posture at a glance: whether it is on, how far it is trusted, and what the last seven days produced. */
function DarkFactoryCard({
  owner,
  repo,
  darkFactoryEnabled,
  trustLevel,
  darkTasksWeek,
  autoMergedWeek,
  escalationsWeek,
}: Pick<
  RepoOverviewViewProps,
  | "owner"
  | "repo"
  | "darkFactoryEnabled"
  | "trustLevel"
  | "darkTasksWeek"
  | "autoMergedWeek"
  | "escalationsWeek"
>) {
  return (
    <div className={`spec-card ${styles.dfCard}`}>
      <div className={styles.dfHead}>
        <h3 className={styles.dfTitle}>Dark Factory</h3>
        <Link href={`/repos/${owner}/${repo}/settings`} className="meta">
          configure →
        </Link>
      </div>
      <div className={styles.stats}>
        <Stat
          label="Mode"
          value={
            darkFactoryEnabled ? (
              <span className={styles.success}>Enabled</span>
            ) : (
              <span className="meta">Off (legacy)</span>
            )
          }
        />
        <Stat label="Trust" value={trustLevel} />
        <Stat label="Tasks (7d)" value={darkTasksWeek} />
        <Stat
          label="Auto-merged (7d)"
          value={autoMergedWeek}
          tone={autoMergedWeek > 0 ? styles.success : undefined}
        />
        <Stat
          label="Escalations (7d)"
          value={escalationsWeek}
          tone={escalationsWeek > 0 ? styles.danger : undefined}
        />
      </div>
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

function RecentTasks({
  owner,
  repo,
  recentTasks,
}: Pick<RepoOverviewViewProps, "owner" | "repo" | "recentTasks">) {
  // No table at all when there are no tasks — an empty grid says less than the invitation to create one.
  if (recentTasks.length === 0) {
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

  return (
    <DataTable
      title="Recent Tasks"
      columns={["Task", "Status", "PR", "Created"]}
      rows={recentTasks}
      rowKey={(t) => String(t.id)}
      cells={(t) => [
        <Link href={`/tasks/${t.id}`} key="task">
          {t.description.substring(0, 60)}...
        </Link>,
        <span className={`op-badge op-${t.status}`} key="status">
          {formatEnumLabel(t.status)}
        </span>,
        t.pr_url ? (
          <a href={t.pr_url} target="_blank" key="pr">
            PR
          </a>
        ) : (
          "—"
        ),
        <span className="meta" key="created">
          <TimeAgo date={t.created_at} />
        </span>,
      ]}
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
      {latestEvents.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {latestEvents.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </tbody>
        </table>
      ) : (
        <Alert variant="secondary">No events yet.</Alert>
      )}
    </>
  );
}
