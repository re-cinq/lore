import type { ReactNode } from "react";
import Link from "next/link";
import type { AssemblyRun, AssemblyRunNode } from "@/lib/assembly-runs";
import { isFloorEngine } from "@/lib/assembly-run-rows";
import CollapsibleCard from "@/components/CollapsibleCard";
import { formatDuration, runHeaderVisual } from "@/lib/assembly-run-presenter";
import type { RunBag } from "@/lib/run-bag";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import { CancelRunButton } from "./CancelRunButton";
import { CancelTaskButton } from "./CancelTaskButton";
import RunBagFacts from "./RunBagFacts";
import styles from "./AssemblyRunView.module.css";

const EM_DASH = "—";

export interface AssemblyRunViewProps {
  run: AssemblyRun;
  /** Whose move it is when only people hold the open run; null while a pod runs or the run ended. */
  waitingOn?: string | null;
}

// Run header — the trail, the line's name and its status. The facts card is `RunFacts`, drawn under the graph (run-viz FR4.14); per-node state lives in the visualization panel below.
export default function AssemblyRunView({
  run,
  waitingOn = null,
}: AssemblyRunViewProps) {
  const visual = runHeaderVisual(run, waitingOn);

  return (
    <div className={styles.top}>
      <RunTrail run={run} />
      <div className={styles.header}>
        <h1>{run.blueprintName}</h1>
        <span className={`${styles.status} ${styles[visual.tone]}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {visual.label}
        </span>
        <CompareLink runId={run.id} />
      </div>
    </div>
  );
}

/** Opens the comparison with this run as A; the compare page offers the other runs of its line as B. */
function CompareLink({ runId }: { runId: string }) {
  return (
    <Link
      href={`/compare?a=${encodeURIComponent(runId)}`}
      className={styles.compare}
    >
      Compare
    </Link>
  );
}

/** Where this run sits: the runs list, its repo, the backlog when one started it, then the line it ran — the same trail every other detail page carries. */
function RunTrail({ run }: AssemblyRunViewProps) {
  return (
    <div className={`breadcrumb ${styles.trail}`}>
      <Link href="/assembly-runs">Assembly runs</Link> /{" "}
      <Link href={`/repos/${run.repo}`}>{run.repo}</Link> /{" "}
      <BacklogStep run={run} />
      <strong>{run.blueprintName}</strong>
    </div>
  );
}

interface RunFactsProps {
  run: AssemblyRunViewProps["run"];
  /** The items the floor holds in the run's bag; null while unread, or for a run it does not have. */
  bag?: RunBag | null;
  /** The run's attempts, which name who put each bag item there. */
  nodes?: readonly AssemblyRunNode[];
}

/** The line-level facts as one open card: branch, outcome, why, how long, the task, PR and issue it ties to, and under them the run's bag. */
export function RunFacts({ run, bag = null, nodes = [] }: RunFactsProps) {
  return (
    <CollapsibleCard title="Run facts" defaultOpen>
      <dl className={`${styles.facts} ${styles.factTiles}`}>
        <Fact label="Branch" valueClass={styles.mono}>
          {run.branch ?? EM_DASH}
        </Fact>
        <Fact label="Outcome">{run.outcome ?? EM_DASH}</Fact>
        <ReasonFact reason={run.reason} />
        <Fact label="Duration">{formatDuration(run.durationSeconds)}</Fact>
        <CancelFact run={run} />
        <PrFact prUrl={run.prUrl} prNumber={run.prNumber} />
        <IssueFact issueUrl={run.issueUrl} issueNumber={run.issueNumber} />
      </dl>
      <RunBagFacts runId={run.id} bag={bag} nodes={nodes} />
    </CollapsibleCard>
  );
}

/** One name/value pair, wrapped so the Lore family can draw it as a tile; other families lay the wrapper out of the way. */
function Fact(props: {
  label: string;
  valueClass?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt>{props.label}</dt>
      <dd className={props.valueClass}>{props.children}</dd>
    </div>
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

function ReasonFact({ reason }: { reason: string | null }) {
  if (!reason) {
    return null;
  }

  return (
    <Fact label="Reason" valueClass={styles.reason}>
      {reason}
    </Fact>
  );
}

/** One cancel per open run. A floor run is cancelled on the floor, task or none: cancelling its task marks the row and leaves the floor run walking, and the run's settle then settles the task. A run Lore's own engine walked cancels its task, which ends the run with it; with no task it has nothing left to cancel it. */
function CancelFact({ run }: AssemblyRunViewProps) {
  if (isTerminalRunStatus(run.status)) {
    return null;
  }

  if (isFloorEngine(run.engine)) {
    return (
      <Fact label="Run">
        <CancelRunButton runId={run.id} />
      </Fact>
    );
  }

  return run.taskId ? (
    <Fact label="Task">
      <CancelTaskButton taskId={run.taskId} />
    </Fact>
  ) : null;
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
    <Fact label="PR">
      <a href={prUrl} target="_blank" rel="noreferrer">
        #{prNumber}
      </a>
    </Fact>
  );
}

interface IssueFactProps {
  issueUrl: string | null;
  issueNumber: number | null;
}

function IssueFact({ issueUrl, issueNumber }: IssueFactProps) {
  if (!issueUrl || !issueNumber) {
    return null;
  }

  return (
    <Fact label="Issue">
      <a href={issueUrl} target="_blank" rel="noreferrer">
        #{issueNumber}
      </a>
    </Fact>
  );
}
