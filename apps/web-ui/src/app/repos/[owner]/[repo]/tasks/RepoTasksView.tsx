import Link from "next/link";
import HelpPopover from "@/components/HelpPopover";
import AssemblyRunsTable from "@/app/assembly-runs/AssemblyRunsTable";
import { type AssemblyRun } from "@/lib/assembly-runs";
import styles from "./RepoTasksView.module.css";

export interface RepoTasksViewProps {
  owner: string;
  repo: string;
  runs: AssemblyRun[];
}

/** What a run on this tab actually is. Answers the three questions the table raises but cannot: what one row represents, where the work happens, and why some task types are missing from this repo. */
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

/** The three questions the table raises but cannot answer: what one row represents, where the work happens, and why some task types are missing from this repo. */
function AssemblyLinePoints() {
  return (
    <ul>
      <li>
        Each task runs the pipeline: pull repo context → agent works →
        deterministic validation (lint/typecheck) → branch + PR.
      </li>
      <li>
        Simple types run via direct API calls; <strong>implementation</strong>{" "}
        and <strong>review</strong> run in ephemeral Job pods.
      </li>
      <li>
        Which types are allowed is gated by the repo&apos;s{" "}
        <strong>trust level</strong> (see Settings).
      </li>
    </ul>
  );
}

type TasksHeaderProps = Pick<RepoTasksViewProps, "owner" | "repo">;

function TasksHeader({ owner, repo }: TasksHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Assembly Runs</h2>
        <AssemblyLineHelp />
      </div>
      <Link href={`/repos/${owner}/${repo}/tasks/create`}>
        <button>+ New Task</button>
      </Link>
    </div>
  );
}

/** Per-repo assembly-runs tab: pure render of runs via shared <AssemblyRunsTable>. */
export default function RepoTasksView(props: RepoTasksViewProps) {
  const { owner, repo, runs } = props;

  return (
    <div>
      <TasksHeader owner={owner} repo={repo} />
      <p className={`meta ${styles.intro}`}>
        Assembly lines targeting this repo. Delegate work to agents and track
        their status, stages, PRs, and cost.
      </p>
      <AssemblyRunsTable runs={runs} />
    </div>
  );
}
