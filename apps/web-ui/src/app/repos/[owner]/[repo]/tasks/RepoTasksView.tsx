import Link from "next/link";
import HelpPopover from "@/components/HelpPopover";
import AssemblyLineRunsTable from "@/app/assembly-lines/AssemblyLineRunsTable";
import { type AssemblyLineRun } from "@/lib/assembly-line-runs";
import styles from "./RepoTasksView.module.css";

export interface RepoTasksViewProps {
  owner: string;
  repo: string;
  runs: AssemblyLineRun[];
}

/**
 * Per-repo assembly-lines tab, scoped to one repo. Pure render: the container
 * (`page.tsx`) fetches the per-attempt runs and this component renders them
 * through the shared <AssemblyLineRunsTable>.
 */
export default function RepoTasksView({
  owner,
  repo,
  runs,
}: RepoTasksViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>Assembly Lines</h2>
          <HelpPopover label="How assembly lines work">
            <p>
              An assembly line is one execution attempt: a graph of nodes (agent
              and station steps) that produces one PR, tracked per attempt.
            </p>
            <ul>
              <li>
                Each task runs the pipeline: pull repo context → agent works →
                deterministic validation (lint/typecheck) → branch + PR.
              </li>
              <li>
                Simple types run via direct API calls;{" "}
                <strong>implementation</strong> and <strong>review</strong> run
                in ephemeral Job pods.
              </li>
              <li>
                Which types are allowed is gated by the repo&apos;s{" "}
                <strong>trust level</strong> (see Settings).
              </li>
            </ul>
          </HelpPopover>
        </div>
        <Link href={`/repos/${owner}/${repo}/tasks/create`}>
          <button>+ New Task</button>
        </Link>
      </div>
      <p className={`meta ${styles.intro}`}>
        Assembly lines targeting this repo. Delegate work to agents and track
        their status, stages, PRs, and cost.
      </p>
      <AssemblyLineRunsTable runs={runs} />
    </div>
  );
}
