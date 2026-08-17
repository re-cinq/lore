"use client";

import styles from "./FailureBlock.module.scss";
import { submittedFeedback } from "@/lib/submitted-feedback";
import { SubmitButton } from "@/components/SubmitButton";
import type { SectionAnswers } from "@/lib/feature-types";

export default function FailureBlock({
  iteration,
  failureReason,
  answers,
  run,
  pending,
  onRetry,
}: {
  iteration: number;
  failureReason: string | null | undefined;
  /** What the author submitted for this round — persisted before the run started,
   *  so a failure never loses it. Shown here because the wizard clears the form on
   *  submit and this is otherwise the last place those words could be read. */
  answers?: SectionAnswers | null;
  /** The round's assembly line, for the recorded reason + a link to the transcript. */
  run?: { id: string; reason: string | null } | null;
  pending: boolean;
  onRetry: () => void;
}) {
  // The task's failure_reason is the richest text (it carries the failing pod's log
  // tail); the line's reason names the node that failed. Either beats guessing.
  const diagnosis = failureReason || run?.reason;
  const submitted = submittedFeedback(answers);

  return (
    <div className={`spec-card ${styles.failure}`} role="alert">
      <p className={styles.headline}>Planning round {iteration} failed.</p>
      {!diagnosis && (
        <p className="meta">
          The run finished without producing a result, and recorded no reason.
          The transcript below has the agent&apos;s own error — read it before
          retrying. A missing model credential is one cause among several, not
          the likely one.
        </p>
      )}
      {diagnosis && <pre className={styles.diagnosis}>{diagnosis}</pre>}
      {run && (
        <p className="meta">
          <a href={`/assembly-runs/${run.id}`}>
            View the full run transcript →
          </a>
        </p>
      )}
      {submitted.length > 0 && (
        <details className={styles.submitted} open>
          <summary className="meta">Your input for this round — kept</summary>
          <dl className={styles.submittedList}>
            {submitted.map((line) => (
              <div key={line.heading} className={styles.submittedItem}>
                <dt className={`meta ${styles.submittedHeading}`}>
                  {line.heading}
                  {line.direction ? ` — ${line.direction}` : ""}
                </dt>
                {line.body && (
                  <dd className={styles.submittedBody}>{line.body}</dd>
                )}
              </div>
            ))}
          </dl>
        </details>
      )}
      <SubmitButton
        type="button"
        pending={pending}
        pendingLabel="Retrying…"
        onClick={onRetry}
      >
        Retry
      </SubmitButton>
    </div>
  );
}
