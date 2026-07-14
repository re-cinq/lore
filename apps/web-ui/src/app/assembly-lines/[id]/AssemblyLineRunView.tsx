import Link from "next/link";
import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "@/lib/assembly-line-runs";
import {
  formatDuration,
  runStatusVisual,
} from "@/lib/assembly-line-presenter";
import styles from "./AssemblyLineRunView.module.css";

const EM_DASH = "—";

export interface AssemblyLineRunViewProps {
  run: AssemblyLineRun;
  nodes: AssemblyLineRunNode[];
}

/** Run detail — the per-attempt execution: header facts + the node timeline from
 *  pipeline.assembly_line_nodes. Pure render. */
export default function AssemblyLineRunView({
  run,
  nodes,
}: AssemblyLineRunViewProps) {
  const visual = runStatusVisual(run.status, run.outcome);

  return (
    <div>
      <div className={styles.header}>
        <h1>{run.definitionName}</h1>
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

      <h2>Nodes</h2>
      {nodes.length === 0 ? (
        <p className={styles.empty}>No node executions recorded.</p>
      ) : (
        <table className={styles.nodes}>
          <thead>
            <tr>
              <th>Node</th>
              <th>Iter</th>
              <th>Outcome</th>
              <th>Agent CR</th>
              <th>Commit</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node, i) => (
              <tr key={`${node.nodeId}-${node.iteration}-${i}`}>
                <td>{node.nodeId}</td>
                <td>{node.iteration}</td>
                <td>{node.outcome ?? EM_DASH}</td>
                <td className={styles.mono}>{node.agentCrName ?? EM_DASH}</td>
                <td className={styles.mono}>
                  {node.commitSha ? (
                    <a
                      href={`https://github.com/${run.repo}/commit/${node.commitSha}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {node.commitSha.substring(0, 7)}
                    </a>
                  ) : (
                    EM_DASH
                  )}
                </td>
                <td>{formatDuration(node.durationSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
