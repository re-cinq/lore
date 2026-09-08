"use client";

import styles from "./FailureBlock.module.scss";
import { submittedFeedback } from "@/lib/submitted-feedback";
import { SubmitButton } from "@/components/SubmitButton";
import type { SectionAnswers } from "@/lib/feature-types";
import type { SubmittedLine } from "@/lib/submitted-feedback";

function SubmittedList({ submitted }: { submitted: SubmittedLine[] }) {
  if (submitted.length === 0) {
    return null;
  }

  return (
    <details className={styles.submitted} open>
      <summary className="meta">Your input for this round — kept</summary>
      <dl className={styles.submittedList}>
        {submitted.map((line) => (
          <div key={line.heading} className={styles.submittedItem}>
            <dt className={`meta ${styles.submittedHeading}`}>
              {line.heading}
              {line.direction ? ` — ${line.direction}` : ""}
            </dt>
            {line.body && <dd className={styles.submittedBody}>{line.body}</dd>}
          </div>
        ))}
      </dl>
    </details>
  );
}

interface FailureBlockProps {
  iteration: number;
  failureReason: string | null | undefined;
  /** Author's round submission, persisted before the run: shown here because the wizard clears the form on submit. */
  answers?: SectionAnswers | null;
  /** The round's assembly line, for the recorded reason and a link to the transcript. */
  run?: { id: string; reason: string | null } | null;
  pending: boolean;
  onRetry: () => void;
}

/** The way to the run's own record. Always worth offering when a run exists: the block above summarizes, and the transcript is where the agent said what actually happened. */
function TranscriptLink({ runId }: { runId?: string }) {
  if (!runId) {
    return null;
  }

  return (
    <p className="meta">
      <a href={`/assembly-runs/${runId}`}>View the full run transcript →</a>
    </p>
  );
}

/** What went wrong, or an admission that nothing was recorded. `failure_reason` is preferred over the run's own reason because the Floor composes it from the node's CLASSIFIED failure (#1455) rather than from the routing statement. The no-reason text deliberately refuses to guess: naming a likely cause sends readers to check a credential when the transcript would have told them. */
function Diagnosis({ reason }: { reason: string | null | undefined }) {
  if (!reason) {
    return (
      <p className="meta">
        The run finished without producing a result, and recorded no reason. The
        transcript below has the agent&apos;s own error — read it before
        retrying. A missing model credential is one cause among several, not the
        likely one.
      </p>
    );
  }

  return <pre className={styles.diagnosis}>{reason}</pre>;
}

export default function FailureBlock({
  iteration,
  failureReason,
  answers,
  run,
  pending,
  onRetry,
}: FailureBlockProps) {
  return (
    <div className={`spec-card ${styles.failure}`} role="alert">
      <p className={styles.headline}>Planning round {iteration} failed.</p>
      <Diagnosis reason={failureReason || run?.reason} />
      <TranscriptLink runId={run?.id} />
      <SubmittedList submitted={submittedFeedback(answers)} />
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
