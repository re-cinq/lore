"use client";

import { useState } from "react";
import Link from "next/link";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";
import {
  formatDuration,
  formatRelativeTime,
  runStatusVisual,
} from "@/lib/assembly-line-presenter";
import { formatCost, shortAgentId } from "@/lib/task-presenter";
import PRStatusBadgePanel from "../tasks/PRStatusBadgePanel";
import styles from "./AssemblyLineRunsTable.module.css";

const EM_DASH = "—";
const TABLE_COLUMNS = 9;

/**
 * A `lease_held` skip: the run started, found another run already holding its
 * repo+branch, and finished immediately having done no work. These are pure
 * coordination artifacts (a burst on one branch spawns many), so they are
 * folded away by default rather than drowning the real runs.
 */
const isCoordinationSkip = (run: AssemblyLineRun): boolean =>
  run.status === "finished" && run.outcome === "lease_held";

export interface AssemblyLineRunsTableProps {
  runs: AssemblyLineRun[];
}

/**
 * The one assembly-line table — per-attempt runs from pipeline.assembly_lines.
 * Data down, no actions up beyond a local toggle that reveals the hidden
 * coordination skips. Shared by the global list and the per-repo tab. PR link /
 * creator / cost come from the run's backing task; task-less runs (the
 * webhook-driven family) fall back to args.pr_number / args.actor / the
 * line-keyed llm_calls rows. Em-dash when a run has neither.
 */
export default function AssemblyLineRunsTable({
  runs,
}: AssemblyLineRunsTableProps) {
  const [showSkips, setShowSkips] = useState(false);

  if (runs.length === 0) {
    return <p className={styles.empty}>No assembly line runs.</p>;
  }

  const skipCount = runs.filter(isCoordinationSkip).length;
  const skipLabel = `${skipCount} coordination skip${skipCount === 1 ? "" : "s"}`;
  const visibleRuns = showSkips
    ? runs
    : runs.filter((r) => !isCoordinationSkip(r));
  const noVisibleRuns = visibleRuns.length === 0;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Definition</th>
          <th>Repo</th>
          <th>Branch</th>
          <th>Status</th>
          <th>PR</th>
          <th>Duration</th>
          <th>Started</th>
          <th title="Who triggered the run — the task creator, or the commenter/reviewer/PR author for webhook-driven lines">
            By
          </th>
          <th title="LLM cost — the backing task's total (shared across its run attempts), or the run's own cost for task-less lines">
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {noVisibleRuns ? (
          <tr>
            <td colSpan={TABLE_COLUMNS} className={styles.empty}>
              All runs are coordination skips — use the toggle below to reveal
              them.
            </td>
          </tr>
        ) : (
          visibleRuns.map((run) => {
            const visual = runStatusVisual(run.status, run.outcome);

            return (
              <tr key={run.id}>
                <td>
                  <Link href={`/assembly-lines/${run.id}`}>
                    {run.definitionName}
                  </Link>
                  <span className={styles.subId}>
                    #{run.id.substring(0, 8)}
                  </span>
                </td>
                <td>
                  <Link href={`/repos/${run.repo}`}>{run.repo}</Link>
                </td>
                <td className={styles.branch}>
                  {run.branch ? (
                    <span className={styles.branchText} title={run.branch}>
                      {run.branch}
                    </span>
                  ) : (
                    EM_DASH
                  )}
                </td>
                <td>
                  <span
                    className={`${styles.dot} ${styles[visual.tone]}`}
                    aria-hidden="true"
                  />
                  {visual.label}
                  {run.status === "failed" && run.reason ? (
                    <span className={styles.reason}>{run.reason}</span>
                  ) : null}
                </td>
                <td>
                  {run.prUrl && run.prNumber ? (
                    <span className={styles.pr}>
                      <a href={run.prUrl} target="_blank" rel="noreferrer">
                        #{run.prNumber}
                      </a>
                      {run.taskId ? (
                        <PRStatusBadgePanel taskId={run.taskId} />
                      ) : null}
                    </span>
                  ) : (
                    EM_DASH
                  )}
                </td>
                <td>{formatDuration(run.durationSeconds)}</td>
                <td>{formatRelativeTime(run.startedAt ?? run.createdAt)}</td>
                <td>{run.createdBy ? shortAgentId(run.createdBy) : EM_DASH}</td>
                <td>
                  {run.costUsd !== null ? formatCost(run.costUsd) : EM_DASH}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
      {skipCount > 0 ? (
        <tfoot>
          <tr>
            <td colSpan={TABLE_COLUMNS}>
              <button
                type="button"
                className={styles.skipToggle}
                aria-expanded={showSkips}
                onClick={() => setShowSkips((s) => !s)}
                title="Runs that deferred to another run already holding the same branch and did no work (lease_held)."
              >
                {showSkips ? `Hide ${skipLabel}` : `Show ${skipLabel}`}
              </button>
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
