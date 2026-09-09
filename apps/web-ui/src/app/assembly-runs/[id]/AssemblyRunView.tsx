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

interface PrFactProps {
  prUrl: string | null;
  prNumber: number | null;
}

function PrFact({ prUrl, prNumber }: PrFactProps) {
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

function RunFacts({ run }: AssemblyRunViewProps) {
  return (
    <dl className={styles.facts}>
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
  );
}

// The line the repo's Backlog page runs; a run of any other line did not come from there.
const BACKLOG_LINE = "implementation-loop";

/** The Backlog step, for the runs that page starts and links to. It is a real step in the trail rather than a label: the tickets this run came from are on it. */
function BacklogStep({ run }: AssemblyRunViewProps) {
  if (run.blueprintName !== BACKLOG_LINE) {
    return null;
  }

  return (
    <>
      <Link href={`/repos/${run.repo}/${BACKLOG_LINE}`}>Backlog</Link> /{" "}
    </>
  );
}

/** Where this run sits: the runs list, its repo, the backlog when one started it, then the line it ran — the same trail every other detail page carries. */
function RunTrail({ run }: AssemblyRunViewProps) {
  return (
    <div className="breadcrumb">
      <Link href="/assembly-runs">Assembly Runs</Link> /{" "}
      <Link href={`/repos/${run.repo}`}>{run.repo}</Link> /{" "}
      <BacklogStep run={run} />
      <strong>{run.blueprintName}</strong>
    </div>
  );
}

// Run header — line-level facts only; per-node state lives in the visualization panel below.
export default function AssemblyRunView({ run }: AssemblyRunViewProps) {
  const visual = runStatusVisual(run.status, run.outcome);

  return (
    <div>
      <RunTrail run={run} />
      <div className={styles.header}>
        <h1>{run.blueprintName}</h1>
        <span className={`${styles.status} ${styles[visual.tone]}`}>
          {visual.label}
        </span>
      </div>

      <RunFacts run={run} />
    </div>
  );
}
