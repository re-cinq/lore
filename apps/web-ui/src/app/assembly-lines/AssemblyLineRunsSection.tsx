import { formatRelativeTime } from "@/lib/assembly-lines";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";
import styles from "./AssemblyLineRunsSection.module.css";

export interface AssemblyLineRunsSectionProps {
  runs: AssemblyLineRun[];
}

const formatDurationSeconds = (seconds: number): string =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;

/**
 * The per-attempt execution records from pipeline.assembly_lines (migration
 * 0025) — one row per assembly line run with its node count and outcome. Pure
 * render, no IO; renders nothing on pre-migration databases (empty runs). Sits
 * alongside the task-grouping table until the page re-keys onto run ids.
 */
export default function AssemblyLineRunsSection({
  runs,
}: AssemblyLineRunsSectionProps) {
  if (runs.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Recent assembly line runs</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Definition</th>
            <th>Repo</th>
            <th>Status</th>
            <th>Outcome</th>
            <th>Nodes</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{run.definitionName}</td>
              <td>{run.repo}</td>
              <td>
                <span className={styles[`status_${run.status}`] ?? undefined}>
                  {run.status}
                </span>
              </td>
              <td>
                {run.outcome ?? "—"}
                {run.reason ? (
                  <span className={styles.reason}>{run.reason}</span>
                ) : null}
              </td>
              <td>{run.nodeCount} nodes</td>
              <td>
                {run.durationSeconds !== null
                  ? formatDurationSeconds(run.durationSeconds)
                  : "—"}
              </td>
              <td>{formatRelativeTime(run.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
