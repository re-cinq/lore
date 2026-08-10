"use client";

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
  run,
  pending,
  onRetry,
}: {
  iteration: number;
  failureReason: string | null | undefined;
  /** The round's assembly line, for the recorded reason + a link to the transcript. */
  run?: { id: string; reason: string | null } | null;
  pending: boolean;
  onRetry: () => void;
}) {
  // The task's failure_reason is the richest text (it carries the failing pod's log
  // tail); the line's reason names the node that failed. Either beats guessing.
  const diagnosis = failureReason || run?.reason;

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
          The run finished without producing a result — usually the planning
          agent couldn&apos;t reach the model. Set{" "}
          <code>ANTHROPIC_API_KEY</code> (org billing) and Retry, or check the
          agent logs.
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
      <button type="button" disabled={pending} onClick={onRetry}>
        {pending ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
