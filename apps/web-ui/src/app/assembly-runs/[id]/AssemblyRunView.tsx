import Link from "next/link";
import type { AssemblyRun } from "@/lib/assembly-runs";
import CollapsibleCard from "@/components/CollapsibleCard";
import { formatDuration, runHeaderVisual } from "@/lib/assembly-run-presenter";
import type { RunBag } from "@/lib/run-bag";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import { CancelTaskButton } from "./CancelTaskButton";
import NeedRef from "./NeedRef";
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
    <div>
      <RunTrail run={run} />
      <div className={styles.header}>
        <h1>{run.blueprintName}</h1>
        <span className={`${styles.status} ${styles[visual.tone]}`}>
          {visual.label}
        </span>
      </div>
    </div>
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

interface RunFactsProps {
  run: AssemblyRunViewProps["run"];
  /** The items the floor holds in the run's bag; null while unread, or for a run it does not have. */
  bag?: RunBag | null;
}

/** The line-level facts as one open card: branch, outcome, why, how long, the task, PR and issue it ties to, and under them the run's bag. */
export function RunFacts({ run, bag = null }: RunFactsProps) {
  return (
    <CollapsibleCard title="Run facts" defaultOpen>
      <dl className={styles.facts}>
        <dt>Branch</dt>
        <dd className={styles.mono}>{run.branch ?? EM_DASH}</dd>
        <dt>Outcome</dt>
        <dd>{run.outcome ?? EM_DASH}</dd>
        <ReasonFact reason={run.reason} />
        <dt>Duration</dt>
        <dd>{formatDuration(run.durationSeconds)}</dd>
        <TaskFact run={run} />
        <PrFact prUrl={run.prUrl} prNumber={run.prNumber} />
        <IssueFact issueUrl={run.issueUrl} issueNumber={run.issueNumber} />
      </dl>
      <BagFacts runId={run.id} bag={bag} />
    </CollapsibleCard>
  );
}

const SHORT_SHA_CHARS = 7;

/** What the line has put in the run's bag, by name, each ref where it leads (the same rules as a need, run-viz FR4.4l). Nothing to say, nothing drawn. */
function BagFacts({ runId, bag }: { runId: string; bag: RunBag | null }) {
  const bagEntries = Object.entries(bag ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (bagEntries.length === 0) {
    return null;
  }

  return (
    <div className={styles.bag}>
      <div className={styles.bagHead}>Bag ({bagEntries.length})</div>
      <dl className={styles.facts}>
        {bagEntries.map(([name, bagItem]) => (
          <BagItem key={name} runId={runId} name={name} bagItem={bagItem} />
        ))}
      </dl>
    </div>
  );
}

interface BagItemProps {
  runId: string;
  name: string;
  bagItem: RunBag[string];
}

function BagItem({ runId, name, bagItem }: BagItemProps) {
  return (
    <>
      <dt>{name}</dt>
      <dd>
        <NeedRef runId={runId} value={bagItem.ref} />
        <span className={styles.bagMeta}>{bagMeta(bagItem)}</span>
      </dd>
    </>
  );
}

/** Its kind, who put it there and, for a git item, the commit it was promised, short. */
function bagMeta({ kind, by, sha }: RunBag[string]): string {
  return [kind, by, sha?.slice(0, SHORT_SHA_CHARS)].filter(Boolean).join(" · ");
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
    <>
      <dt>Reason</dt>
      <dd className={styles.reason}>{reason}</dd>
    </>
  );
}

/** Cancelling is the task's to do, and the run page is the only page a task has: offered while the run is still open. */
function TaskFact({ run }: AssemblyRunViewProps) {
  if (!run.taskId || isTerminalRunStatus(run.status)) {
    return null;
  }

  return (
    <>
      <dt>Task</dt>
      <dd>
        <CancelTaskButton taskId={run.taskId} />
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

interface IssueFactProps {
  issueUrl: string | null;
  issueNumber: number | null;
}

function IssueFact({ issueUrl, issueNumber }: IssueFactProps) {
  if (!issueUrl || !issueNumber) {
    return null;
  }

  return (
    <>
      <dt>Issue</dt>
      <dd>
        <a href={issueUrl} target="_blank" rel="noreferrer">
          #{issueNumber}
        </a>
      </dd>
    </>
  );
}
