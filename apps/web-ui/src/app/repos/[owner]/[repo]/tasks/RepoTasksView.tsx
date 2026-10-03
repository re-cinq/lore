import HelpPopover from "@/components/HelpPopover";
import AssemblyRunsLive from "@/app/assembly-runs/AssemblyRunsLive";
import AssemblyRunsTable from "@/app/assembly-runs/AssemblyRunsTable";
import type { FloorRunsPage } from "@/lib/api/floor-runs";
import { type AssemblyRun } from "@/lib/assembly-runs";
import styles from "./RepoTasksView.module.css";

export interface RepoTasksViewProps {
  /** `owner/name` */
  repo: string;
  activeStatus?: string;
  cursor?: string;
  initial: FloorRunsPage;
  /** Runs of the engine Lore ran itself; they no longer change. */
  earlierRuns: AssemblyRun[];
}

/** Per-repo assembly-runs tab: the floor's live runs, then the old engine's runs that no longer change. */
export default function RepoTasksView({
  repo,
  earlierRuns,
  ...live
}: RepoTasksViewProps) {
  return (
    <div>
      <AssemblyRunsLive
        repo={repo}
        basePath={`/repos/${repo}/tasks`}
        {...live}
        heading={<TasksHeading />}
      />
      {earlierRuns.length > 0 && <EarlierRuns runs={earlierRuns} />}
    </div>
  );
}

function TasksHeading() {
  return (
    <div>
      <div className={styles.heading}>
        <h2 className={styles.title}>Assembly Runs</h2>
        <AssemblyLineHelp />
      </div>
      <p className={`meta ${styles.intro}`}>
        Assembly lines targeting this repo. Track their status, stages, PRs, and
        cost.
      </p>
    </div>
  );
}

function EarlierRuns({ runs }: { runs: AssemblyRun[] }) {
  return (
    <section className={styles.earlier}>
      <h3>Earlier runs</h3>
      <p className="meta">
        Runs of the engine Lore ran itself. They no longer change.
      </p>
      <AssemblyRunsTable runs={runs} />
    </section>
  );
}

/** What a run on this tab actually is. */
function AssemblyLineHelp() {
  return (
    <HelpPopover label="How assembly lines work">
      <p>
        An assembly line is one execution attempt: a graph of nodes (agent and
        station steps) that produces one PR, tracked per attempt.
      </p>
      <AssemblyLinePoints />
    </HelpPopover>
  );
}

/** The three questions the table raises but cannot answer: where work starts, where it runs, and why some lines are missing from this repo. */
function AssemblyLinePoints() {
  return (
    <ul>
      <li>
        Work starts from a ticket in the backlog, a plan, or a pull request;
        nothing is started from this page.
      </li>
      <li>Each agent node runs in its own pod; CI judges what it pushed.</li>
      <li>
        Which lines may run is gated by the repo&apos;s{" "}
        <strong>trust level</strong> (see Settings).
      </li>
    </ul>
  );
}
