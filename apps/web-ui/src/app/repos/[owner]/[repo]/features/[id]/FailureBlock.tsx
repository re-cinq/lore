"use client";

import { submittedFeedback } from "@/lib/submitted-feedback";
import type { SectionAnswers } from "@/lib/feature-types";

const PRE_STYLE: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 260,
  overflow: "auto",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 10,
  fontSize: "var(--fs-xs)",
  margin: "8px 0",
};

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
    <div
      className="spec-card"
      style={{ borderColor: "var(--danger)" }}
      role="alert"
    >
      <p style={{ color: "var(--danger)", fontWeight: 600, margin: 0 }}>
        Planning round {iteration} failed.
      </p>
      {!diagnosis && (
        <p className="meta">
          The run finished without producing a result, and recorded no reason.
          The transcript below has the agent&apos;s own error — read it before
          retrying. A missing model credential is one cause among several, not
          the likely one.
        </p>
      )}
      {diagnosis && <pre style={PRE_STYLE}>{diagnosis}</pre>}
      {run && (
        <p className="meta">
          <a href={`/assembly-lines/${run.id}`}>
            View the full run transcript →
          </a>
        </p>
      )}
      {submitted.length > 0 && (
        <details style={{ margin: "8px 0" }} open>
          <summary className="meta">Your input for this round — kept</summary>
          <dl style={{ margin: "6px 0 0" }}>
            {submitted.map((line) => (
              <div key={line.heading} style={{ marginBottom: 6 }}>
                <dt className="meta" style={{ fontWeight: 600 }}>
                  {line.heading}
                  {line.direction ? ` — ${line.direction}` : ""}
                </dt>
                {line.body && (
                  <dd style={{ margin: "2px 0 0 12px" }}>{line.body}</dd>
                )}
              </div>
            ))}
          </dl>
        </details>
      )}
      <button type="button" disabled={pending} onClick={onRetry}>
        {pending ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
