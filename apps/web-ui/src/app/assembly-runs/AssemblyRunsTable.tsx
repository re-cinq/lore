"use client";

import { useState } from "react";
import Link from "next/link";
import type { AssemblyRun } from "@/lib/assembly-runs";
import {
  formatDuration,
  formatRelativeTime,
  runStatusVisual,
} from "@/lib/assembly-run-presenter";
import { formatCost, shortAgentId } from "@/lib/task-presenter";
import MiniPipeline from "@/components/MiniPipeline";
import PRStatusBadgePanel from "../tasks/PRStatusBadgePanel";
import styles from "./AssemblyRunsTable.module.css";

const EM_DASH = "—";
const BASE_COLUMNS = 9;
const columnCountFor = ({ showStages }: StagesProps): number =>
  showStages ? BASE_COLUMNS + 1 : BASE_COLUMNS;
const BY_COLUMN_TITLE =
  "Who triggered the run — the task creator, or the commenter/reviewer/PR author for webhook-driven lines";
const COST_COLUMN_TITLE =
  "LLM cost — the backing task's total (shared across its run attempts), or the run's own cost for task-less lines";
const SKIP_TOGGLE_TITLE =
  "Runs that deferred to another run already holding the same branch and did no work (lease_held).";

// A `lease_held` skip found the repo+branch already held and did no work — a pure coordination artifact, folded away by default.
const isCoordinationSkip = (run: AssemblyRun): boolean =>
  run.status === "finished" && run.outcome === "lease_held";

// A coordination skip did no work — it deferred to a run already holding the branch — so it stays hidden unless asked for.
const withoutCoordinationSkips = (runs: AssemblyRun[]) =>
  runs.filter((r) => !isCoordinationSkip(r));

export interface AssemblyRunsTableProps extends StagesProps {
  runs: AssemblyRun[];
}

interface RunRowProps {
  run: AssemblyRun;
}

interface StagesProps {
  showStages?: boolean;
}

// The one assembly-line table, shared by the global list and per-repo tab. PR/creator/cost come from the backing task; task-less runs fall back to args.pr_number/args.actor/llm_calls, else em-dash.
export default function AssemblyRunsTable(props: AssemblyRunsTableProps) {
  const { runs, showStages } = props;
  const [showSkips, setShowSkips] = useState(false);

  if (runs.length === 0) {
    return <p className={styles.empty}>No assembly line runs.</p>;
  }
  const visibleRuns = showSkips ? runs : withoutCoordinationSkips(runs);

  return (
    <table className={styles.table}>
      <RunsTableHead showStages={showStages} />
      <TableBody visibleRuns={visibleRuns} showStages={showStages} />
      <SkipToggleFooter
        skipCount={runs.filter(isCoordinationSkip).length}
        showStages={showStages}
        showSkips={showSkips}
        onToggle={() => setShowSkips((s) => !s)}
      />
    </table>
  );
}

function RunsTableHead({ showStages }: StagesProps) {
  return (
    <thead>
      <tr>
        <th>Definition</th>
        <th>Repo</th>
        <th>Branch</th>
        <th>Status</th>
        {showStages ? <th>Stages</th> : null}
        <th>PR</th>
        <th>Duration</th>
        <th>Started</th>
        <th title={BY_COLUMN_TITLE}>By</th>
        <th title={COST_COLUMN_TITLE}>Cost</th>
      </tr>
    </thead>
  );
}

interface TableBodyProps extends StagesProps {
  visibleRuns: AssemblyRun[];
}

function TableBody({ visibleRuns, showStages }: TableBodyProps) {
  if (visibleRuns.length === 0) {
    return <AllSkippedBody showStages={showStages} />;
  }

  return (
    <tbody>
      {visibleRuns.map((run) => (
        <RunRow run={run} showStages={showStages} key={run.id} />
      ))}
    </tbody>
  );
}

interface SkipToggleFooterProps extends StagesProps {
  skipCount: number;
  showSkips: boolean;
  onToggle: () => void;
}

/** The row that reveals runs which did nothing. Hidden entirely when there were none — an empty "show 0 skips" control is a control that never has anything to say. */
function SkipToggleFooter(props: SkipToggleFooterProps) {
  if (props.skipCount === 0) {
    return null;
  }

  return (
    <tfoot>
      <tr>
        <td colSpan={columnCountFor(props)}>
          <SkipToggleButton {...props} />
        </td>
      </tr>
    </tfoot>
  );
}

function RunRow({ run, showStages }: RunRowProps & StagesProps) {
  return (
    <tr>
      <DefinitionCell run={run} />
      <RepoCell run={run} />
      <td className={styles.branch}>
        <BranchCell branch={run.branch} />
      </td>
      <td>
        <StatusCell run={run} />
      </td>
      {showStages ? <StagesCell run={run} /> : null}
      <td>
        <RunPrCell run={run} />
      </td>
      <RunSummaryCells run={run} />
    </tr>
  );
}

function AllSkippedBody(props: StagesProps) {
  return (
    <tbody>
      <tr>
        <td colSpan={columnCountFor(props)} className={styles.empty}>
          All runs are coordination skips — use the toggle below to reveal them.
        </td>
      </tr>
    </tbody>
  );
}

function SkipToggleButton({
  skipCount,
  showSkips,
  onToggle,
}: SkipToggleFooterProps) {
  const skipLabel = `${skipCount} coordination skip${skipCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      className={styles.skipToggle}
      aria-expanded={showSkips}
      onClick={onToggle}
      title={SKIP_TOGGLE_TITLE}
    >
      {showSkips ? `Hide ${skipLabel}` : `Show ${skipLabel}`}
    </button>
  );
}

function RepoCell({ run }: RunRowProps) {
  return (
    <td>
      <Link href={`/repos/${run.repo}`}>{run.repo}</Link>
    </td>
  );
}

function StagesCell({ run }: RunRowProps) {
  return (
    <td>
      <MiniPipeline runId={run.id} pipeline={run.pipeline ?? []} />
    </td>
  );
}

function DefinitionCell({ run }: RunRowProps) {
  return (
    <td>
      <Link href={`/assembly-runs/${run.id}`}>{run.blueprintName}</Link>
      <span className={styles.subId}>#{run.id.substring(0, 8)}</span>
    </td>
  );
}

function BranchCell({ branch }: { branch: string | null }) {
  if (!branch) {
    return <>{EM_DASH}</>;
  }

  return (
    <span className={styles.branchText} title={branch}>
      {branch}
    </span>
  );
}

function StatusCell({ run }: RunRowProps) {
  const visual = runStatusVisual(run.status, run.outcome);
  const showReason = run.status === "failed" && run.reason;

  return (
    <>
      <span
        className={`${styles.dot} ${styles[visual.tone]}`}
        aria-hidden="true"
      />
      {visual.label}
      {showReason ? <span className={styles.reason}>{run.reason}</span> : null}
    </>
  );
}

function RunSummaryCells({ run }: RunRowProps) {
  return (
    <>
      <td>{formatDuration(run.durationSeconds)}</td>
      <td>{formatRelativeTime(run.startedAt ?? run.createdAt)}</td>
      <td>{run.createdBy ? shortAgentId(run.createdBy) : EM_DASH}</td>
      <td>{run.costUsd !== null ? formatCost(run.costUsd) : EM_DASH}</td>
    </>
  );
}

/** The PR badge is task-scoped, so a task-less line shows its PR link without one. */
function RunPrCell({ run }: RunRowProps) {
  if (!run.prUrl || !run.prNumber) {
    return <>{EM_DASH}</>;
  }

  return (
    <span className={styles.pr}>
      <a href={run.prUrl} target="_blank" rel="noreferrer">
        #{run.prNumber}
      </a>
      {run.taskId ? <PRStatusBadgePanel taskId={run.taskId} /> : null}
    </span>
  );
}
