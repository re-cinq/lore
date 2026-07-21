import Link from "next/link";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "@/lib/assembly-line-runs";
import { formatDuration, runStatusVisual } from "@/lib/assembly-line-presenter";
import { stepViews, type StepTone } from "@/lib/step-presenter";
import styles from "./AssemblyLineRunView.module.css";

const EM_DASH = "—";

const DOT_CLASS: Record<StepTone, string> = {
  ok: styles.dotOk,
  warn: styles.dotWarn,
  err: styles.dotErr,
  running: styles.dotRunning,
  idle: styles.dotIdle,
};

const PILL_CLASS: Record<StepTone, string> = {
  ok: styles.pillOk,
  warn: styles.pillWarn,
  err: styles.pillErr,
  running: styles.pillRunning,
  idle: styles.pillIdle,
};

export interface AssemblyLineRunViewProps {
  run: AssemblyLineRun;
  nodes: AssemblyLineRunNode[];
  definition: AssemblyLineDefinition | null;
}

/** Run detail — the per-attempt execution: header facts + the node timeline from
 *  pipeline.assembly_line_nodes. Pure render. */
export default function AssemblyLineRunView({
  run,
  nodes,
  definition,
}: AssemblyLineRunViewProps) {
  const visual = runStatusVisual(run.status, run.outcome);
  const steps = stepViews(definition, nodes, run.reason);

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

      <h2>Steps</h2>
      {steps.length === 0 ? (
        <p className={styles.empty}>No node executions recorded.</p>
      ) : (
        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <li
              key={`${step.nodeId}-${step.iteration}-${i}`}
              className={styles.step}
            >
              <span
                className={`${styles.dot} ${DOT_CLASS[step.tone]}`}
                aria-hidden="true"
              />
              <div className={styles.stepHead}>
                <span className={styles.stepName}>{step.nodeId}</span>
                <span className={`${styles.pill} ${PILL_CLASS[step.tone]}`}>
                  {step.label}
                </span>
                <span className={styles.stepMeta}>
                  attempt {step.iteration} ·{" "}
                  {formatDuration(step.durationSeconds)}
                  {step.agentCrName ? ` · ${step.agentCrName}` : ""}
                </span>
                {step.commitSha ? (
                  <a
                    className={styles.mono}
                    href={`https://github.com/${run.repo}/commit/${step.commitSha}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {step.commitSha.substring(0, 7)}
                  </a>
                ) : null}
              </div>
              {step.reason ? (
                <p className={styles.stepReason}>{step.reason}</p>
              ) : null}
              {step.transition ? (
                <p className={styles.stepEdge}>{step.transition}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
