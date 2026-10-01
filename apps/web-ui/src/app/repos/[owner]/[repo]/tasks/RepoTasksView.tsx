import HelpPopover from "@/components/HelpPopover";
import AssemblyRunsTable from "@/app/assembly-runs/AssemblyRunsTable";
import { type AssemblyRun } from "@/lib/assembly-runs";
import styles from "./RepoTasksView.module.css";

export interface RepoTasksViewProps {
  runs: AssemblyRun[];
}

/** Per-repo assembly-runs tab: pure render of runs via shared <AssemblyRunsTable>. */
export default function RepoTasksView({ runs }: RepoTasksViewProps) {
  return (
    <div>
      <TasksHeader />
      <p className={`meta ${styles.intro}`}>
        Assembly lines targeting this repo. Track their status, stages, PRs, and
        cost.
      </p>
      <AssemblyRunsTable runs={runs} />
    </div>
  );
}

function TasksHeader() {
  return (
    <div className={styles.header}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Assembly Runs</h2>
        <AssemblyLineHelp />
      </div>
    </div>
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
