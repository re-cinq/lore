import Link from "next/link";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { formatDuration, runStatusVisual } from "@/lib/assembly-run-presenter";
import styles from "./AssemblyRunView.module.css";

const EM_DASH = "—";

export interface AssemblyRunViewProps {
  run: AssemblyRun;
}

function ReasonFact({ reason }: { reason: string | null }) {
  if (!reason) {
    return null;
  }

  return (
    <>
      <dt>Reason</dt>
      <dd className={styles.reason}>{reason}</dd>
    </>
  );
}

function TaskFact({ taskId }: { taskId: string | null }) {
  if (!taskId) {
    return null;
  }

  return (
    <>
      <dt>Task</dt>
      <dd>
        <Link href={`/tasks/${taskId}`}>View task →</Link>
      </dd>
    </>
  );
}

function PrFact({
  prUrl,
  prNumber,
}: {
  prUrl: string | null;
  prNumber: number | null;
}) {
  if (!prUrl || !prNumber) {
    return null;
  }

  return (
    <>
      <dt>PR</dt>
      <dd>
        <a href={prUrl} target="_blank" rel="noreferrer">
          #{prNumber}
        </a>
      </dd>
    </>
  );
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
        <ReasonFact reason={run.reason} />
        <dt>Duration</dt>
        <dd>{formatDuration(run.durationSeconds)}</dd>
        <TaskFact taskId={run.taskId} />
        <PrFact prUrl={run.prUrl} prNumber={run.prNumber} />
      </dl>
    </div>
  );
}
