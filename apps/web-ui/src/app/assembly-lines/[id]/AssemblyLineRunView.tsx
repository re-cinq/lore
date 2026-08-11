import Link from "next/link";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "@/lib/assembly-line-runs";
import { formatDuration, runStatusVisual } from "@/lib/assembly-line-presenter";
import { stepViews, type StepTone } from "@/lib/step-presenter";
import { RerunFromNodeButton } from "./RerunFromNodeButton";
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
  /** True when the run's definition is a real builtin (not synthesized from
   *  visit rows) — the fork drift-guard needs a graph to hash, so only these
   *  runs offer "Rerun from here". */
  forkable?: boolean;
}

/** Run detail — the per-attempt execution: header facts + the node timeline from
 *  pipeline.assembly_line_nodes. Pure render. */
export default function AssemblyLineRunView({
  run,
  nodes,
  definition,
  forkable = false,
}: AssemblyLineRunViewProps) {
  const visual = runStatusVisual(run.status, run.outcome);
  const steps = stepViews(definition, nodes, run.reason);
  // Only a terminal line forks (FR3), and only from a completed node row (FR2)
  // — the port re-validates, but offering a button it would refuse is noise.
  // One button per node, on its latest row: forking a node always resumes from
  // its LATEST completed iteration, so earlier rows would duplicate it.
  const rerunnable = forkable && ["finished", "failed"].includes(run.status);
  const lastRowIndexByNode = new Map(steps.map((step, i) => [step.nodeId, i]));

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
        {run.resumedFromLineId ? (
          <>
            <dt>Forked from</dt>
            <dd>
              <Link href={`/assembly-lines/${run.resumedFromLineId}`}>
                source run
                {run.resumedFromNodeId
                  ? ` (through ${run.resumedFromNodeId})`
                  : ""}{" "}
                →
              </Link>
            </dd>
          </>
        ) : null}
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
                {i < run.inheritedNodeCount ? (
                  <span className={`${styles.pill} ${styles.pillIdle}`}>
                    Inherited
                  </span>
                ) : null}
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
                {rerunnable &&
                step.outcome !== null &&
                lastRowIndexByNode.get(step.nodeId) === i ? (
                  <RerunFromNodeButton runId={run.id} nodeId={step.nodeId} />
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
