import Link from "next/link";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { formatDuration, runStatusVisual } from "@/lib/assembly-run-presenter";
import styles from "./AssemblyRunView.module.css";

const EM_DASH = "—";

export interface AssemblyRunViewProps {
  run: AssemblyRun;
}

// Run header — line-level facts only; per-node state lives in the visualization panel below.
export default function AssemblyRunView({ run }: AssemblyRunViewProps) {
  const visual = runStatusVisual(run.status, run.outcome);

  return (
    <div>
      <div className={styles.header}>
        <h1>{run.blueprintName}</h1>
        <span className={`${styles.status} ${styles[visual.tone]}`}>
          {visual.label}
        </span>
      </div>

      <dl className={styles.facts}>
        <dt>Repo</dt>
        <dd>
          <Link href={`/repos/${run.repo}`}>{run.repo}</Link>
        </dd>
        <dt>Branch</dt>
        <dd className={styles.mono}>{run.branch ?? EM_DASH}</dd>
        <dt>Outcome</dt>
        <dd>{run.outcome ?? EM_DASH}</dd>
        {run.reason ? (
          <>
            <dt>Reason</dt>
            <dd className={styles.reason}>{run.reason}</dd>
          </>
        ) : null}
        <dt>Duration</dt>
        <dd>{formatDuration(run.durationSeconds)}</dd>
        {run.taskId ? (
          <>
            <dt>Task</dt>
            <dd>
              <Link href={`/tasks/${run.taskId}`}>View task →</Link>
            </dd>
          </>
        ) : null}
        {run.prUrl && run.prNumber ? (
          <>
            <dt>PR</dt>
            <dd>
              <a href={run.prUrl} target="_blank" rel="noreferrer">
                #{run.prNumber}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
