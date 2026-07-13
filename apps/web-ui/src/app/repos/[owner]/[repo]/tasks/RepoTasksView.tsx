import Link from "next/link";
import HelpPopover from "@/components/HelpPopover";
import AssemblyLineTable from "@/app/assembly-lines/AssemblyLineTable";
import { type AssemblyLine } from "@/lib/assembly-lines";
import styles from "./RepoTasksView.module.css";

export interface RepoTasksViewProps {
  owner: string;
  repo: string;
  runs: AssemblyLine[];
}

/**
 * Per-repo assembly-lines tab — GitLab-pipelines-style, scoped to one repo.
 * Pure render: the container (`page.tsx`) groups the rows into runs and this
 * component renders them through the shared <AssemblyLineTable>.
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
              An assembly line is a chain of related tasks that produce one PR —
              the implementation task, its review, and any revisions — grouped
              into a single run.
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
      <AssemblyLineTable runs={runs} showCost />
    </div>
  );
}
