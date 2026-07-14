import Link from "next/link";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";
import {
  formatDuration,
  formatRelativeTime,
  runStatusVisual,
} from "@/lib/assembly-line-presenter";
import { formatCost, shortAgentId } from "@/lib/task-presenter";
import PRStatusBadge from "../tasks/PRStatusBadge";
import styles from "./AssemblyLineRunsTable.module.css";

const EM_DASH = "—";

export interface AssemblyLineRunsTableProps {
  runs: AssemblyLineRun[];
}

/**
 * The one assembly-line table — per-attempt runs from pipeline.assembly_lines.
 * Pure render (data down, no actions up). Shared by the global list and the
 * per-repo tab. PR link / creator / cost come from the run's backing task (or
 * args.pr_number for code-review runs); em-dash when the run has no task.
 */
export default function AssemblyLineRunsTable({
  runs,
}: AssemblyLineRunsTableProps) {
  if (runs.length === 0) {
    return <p className={styles.empty}>No assembly line runs.</p>;
  }

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
          <th>By</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => {
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
              <td className={styles.branch}>{run.branch ?? EM_DASH}</td>
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
                    {run.taskId ? <PRStatusBadge taskId={run.taskId} /> : null}
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
        })}
      </tbody>
    </table>
  );
}
