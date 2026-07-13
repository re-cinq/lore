"use client";

const PRE_STYLE: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 260,
  overflow: "auto",
  background: "var(--bg-elevated, #f6f8fa)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 6,
  padding: 10,
  fontSize: 12,
  margin: "8px 0",
};

export default function FailureBlock({
  iteration,
  failureReason,
  pending,
  onRetry,
}: {
  iteration: number;
  failureReason: string | null | undefined;
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="spec-card" style={{ borderColor: "#dc2626" }} role="alert">
      <p style={{ color: "#dc2626", fontWeight: 600, margin: 0 }}>
        Planning round {iteration} failed.
      </p>
      {!failureReason && (
        <p className="meta">
          The run finished without producing a result — usually the planning
          agent couldn&apos;t reach the model. Set{" "}
          <code>ANTHROPIC_API_KEY</code> (org billing) and Retry, or check the
          agent logs.
        </p>
      )}
      {failureReason && <pre style={PRE_STYLE}>{failureReason}</pre>}
      <button type="button" disabled={pending} onClick={onRetry}>
        {pending ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
