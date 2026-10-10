// The looped node's attempts inside its detail card (run-viz FR4.1f): one row per visit, each a button that puts that attempt in the center column. Pure render.
import { formatDuration } from "@/lib/assembly-run-presenter";
import type { StepView } from "@/lib/step-presenter";
import { StatusPill } from "@/components/StatusPill";
import styles from "./RunNodeDetail.module.css";

interface AttemptHistoryProps {
  attempts: readonly StepView[];
  repo: string;
  selectedIteration?: number;
  onPickAttempt?: (iteration: number) => void;
}

/** Only shown once a node has been visited more than once — a single attempt is already the card above. */
export function AttemptHistory(props: AttemptHistoryProps) {
  const { attempts } = props;

  if (attempts.length <= 1) {
    return null;
  }

  return (
    <div className={styles.attempts}>
      <div className={styles.attemptsHead}>Attempts ({attempts.length})</div>
      <ol className={styles.attemptList}>
        {attempts.map((step) => (
          <AttemptRow key={step.iteration} step={step} {...props} />
        ))}
      </ol>
    </div>
  );
}

type AttemptRowProps = AttemptHistoryProps & { step: StepView };

/** One attempt: the button that picks it, then what it left behind. The refs stay outside the button because a link inside a button is not a thing a browser can be asked for. */
function AttemptRow(props: AttemptRowProps) {
  const { step, repo, selectedIteration } = props;
  const selected = step.iteration === selectedIteration;

  return (
    <li
      className={styles.attemptItem}
      aria-current={selected ? "true" : undefined}
    >
      <AttemptPickButton {...props} selected={selected} />
      <AttemptRefs step={step} repo={repo} />
    </li>
  );
}

function AttemptPickButton({
  step,
  selected,
  onPickAttempt,
}: AttemptRowProps & { selected: boolean }) {
  return (
    <button
      type="button"
      className={styles.attemptButton}
      aria-pressed={selected}
      onClick={() => onPickAttempt?.(step.iteration)}
    >
      <span className={styles.attemptMeta}>attempt {step.iteration}</span>
      <StatusPill label={step.label} tone={step.tone} />
      <span className={styles.attemptMeta}>
        {formatDuration(step.durationSeconds)}
      </span>
    </button>
  );
}

/** What an attempt left behind: the pod that ran it, the commit it made, the edge it took, and why. Each is omitted when absent rather than rendered blank — an attempt that never reached a pod has no CR name, and an empty slot would read as one that failed to load. */
function AttemptRefs({ step, repo }: Pick<AttemptRowProps, "step" | "repo">) {
  return (
    <>
      {step.agentCrName ? (
        <span className={`${styles.attemptMeta} ${styles.mono}`}>
          {step.agentCrName}
        </span>
      ) : null}
      <CommitLink sha={step.commitSha} repo={repo} />
      {step.transition ? (
        <span className={styles.attemptEdge}>{step.transition}</span>
      ) : null}
      {step.reason ? (
        <span className={styles.attemptReason}>{step.reason}</span>
      ) : null}
    </>
  );
}

/** The stage commit this attempt made, linked to GitHub. Shown short, as a sha is read: the full forty characters carry no more meaning to a human and crowd out the row. */
function CommitLink({ sha, repo }: { sha: string | null; repo: string }) {
  if (!sha) {
    return null;
  }

  return (
    <a
      className={styles.mono}
      href={`https://github.com/${repo}/commit/${sha}`}
      target="_blank"
      rel="noreferrer"
    >
      {sha.substring(0, 7)}
    </a>
  );
}
