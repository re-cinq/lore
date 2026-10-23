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
import Panel, { PanelTable } from "@/components/Panel";

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
  /** Chunks indexed for the repo; 0 when the summary could not be read. */
  chunkCount: number;
  /** The convention files (CLAUDE.md, AGENTS.md, rules) ingested for the repo. */
  conventionFiles: string[];
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

  return (
    <div className={styles.page}>
      <EnrollmentSection
        checks={enrollmentChecks}
        reonboardAction={props.reonboardAction}
        setupWebhookAction={props.setupWebhookAction}
      />
      <StatTiles {...props} />
      <WorkColumns {...props} />
      {readme && <ReadmeBox {...readme} />}
      <LatestEvents
        owner={owner}
        repo={repo}
        latestEvents={props.latestEvents}
      />
    </div>
  );
}

/** What the repo has been doing beside what its agents are told. */
function WorkColumns(props: RepoOverviewViewProps) {
  const { owner, repo } = props;

  return (
    <div className={styles.columns}>
      <RecentTasks owner={owner} repo={repo} recentTasks={props.recentTasks} />
      <ContextFiles owner={owner} repo={repo} files={props.conventionFiles} />
    </div>
  );
}

type RepoLinkProps = Pick<RepoOverviewViewProps, "owner" | "repo">;

type StatProps = RepoLinkProps &
  Pick<RepoOverviewViewProps, "trustLevel" | "tasksWeek" | "chunkCount">;

/** The week's tasks, the indexed chunks and how far the repo is trusted — the first figures a reader takes in. */
function StatTiles(props: StatProps) {
  const settings = `/repos/${props.owner}/${props.repo}/settings`;

  return (
    <section className={styles.stats} aria-label="Activity">
      <Stat label="Tasks (7d)" value={props.tasksWeek} lead />
      <Stat label="Indexed chunks" value={props.chunkCount.toLocaleString()} />
      <Stat
        label="Trust"
        value={props.trustLevel}
        aside={<Link href={settings}>configure →</Link>}
      />
    </section>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** The headline figure, drawn on the brand's filled tile. */
  lead?: boolean;
  aside?: ReactNode;
}

function Stat({ label, value, lead, aside }: StatTileProps) {
  return (
    <div className={lead ? `${styles.stat} ${styles.statLead}` : styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {aside && <span className={styles.statAside}>{aside}</span>}
    </div>
  );
}

type RecentTasksProps = RepoLinkProps &
  Pick<RepoOverviewViewProps, "recentTasks">;

function RecentTasks({ owner, repo, recentTasks }: RecentTasksProps) {
  const runs = `/assembly-runs?repo=${owner}/${repo}`;

  return (
    <Panel
      title="Recent tasks"
      link={{ href: runs, text: "All runs →" }}
      className={styles.mainPanel}
    >
      {recentTasks.length === 0 ? (
        <Alert variant="secondary">No tasks yet.</Alert>
      ) : (
        <TaskList tasks={recentTasks} />
      )}
    </Panel>
  );
}

function TaskList({ tasks }: { tasks: RecentTask[] }) {
  return (
    <ul className={styles.taskList}>
      {tasks.map((t) => (
        <TaskRow key={String(t.id)} task={t} />
      ))}
    </ul>
  );
}

/** One task row. The description is truncated because this list is a glance at what the repo has been doing — the link is to the task's run, which the run page resolves from the task id. */
function TaskRow({ task }: { task: RecentTask }) {
  return (
    <li className={styles.taskRow}>
      <Link href={`/assembly-runs/${task.id}`} className={styles.taskTitle}>
        {task.description.substring(0, 60)}...
      </Link>
      <span className={`op-badge op-${task.status}`}>
        {formatEnumLabel(task.status)}
      </span>
      <PrCell url={task.pr_url} />
      <span className={`meta ${styles.taskWhen}`}>
        <TimeAgo date={task.created_at} inline />
      </span>
    </li>
  );
}

function PrCell({ url }: { url: RecentTask["pr_url"] }) {
  return (
    <span className={styles.taskPr}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          PR
        </a>
      ) : (
        "—"
      )}
    </span>
  );
}

/** The convention files Lore ingested — what every agent working here is told first. */
function ContextFiles({
  owner,
  repo,
  files,
}: RepoLinkProps & { files: string[] }) {
  return (
    <Panel
      title="Context files"
      link={{ href: `/repos/${owner}/${repo}/context`, text: "Context →" }}
      className={styles.sidePanel}
      soft
    >
      {files.length === 0 ? (
        <p className="meta">No convention files ingested yet.</p>
      ) : (
        <FileList files={files} />
      )}
    </Panel>
  );
}

function FileList({ files }: { files: string[] }) {
  return (
    <ul className={styles.fileList}>
      {files.map((f) => (
        <li key={f} className={styles.file}>
          {f}
        </li>
      ))}
    </ul>
  );
}

function LatestEvents({
  owner,
  repo,
  latestEvents,
}: RepoLinkProps & Pick<RepoOverviewViewProps, "latestEvents">) {
  return (
    <Panel
      title="Latest events"
      link={{ href: `/repos/${owner}/${repo}/events`, text: "Show all →" }}
    >
      <EventsTable events={latestEvents} />
    </Panel>
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
    <PanelTable>
      <table>
        <EventsTableHead />
        <tbody>{events.map(eventRow)}</tbody>
      </table>
    </PanelTable>
  );
}

function eventRow(event: RepoEvent) {
  return <EventRow key={event.id} event={event} />;
}
