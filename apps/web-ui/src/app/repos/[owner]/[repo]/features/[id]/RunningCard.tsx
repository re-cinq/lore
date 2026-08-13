"use client";

import { useEffect, useState } from "react";
import { formatSeconds } from "@/lib/format-time";
import RunVisualizationPanel from "@/app/assembly-lines/[id]/RunVisualizationPanel";
import type { FeatureRunPayload } from "@/lib/feature-run";

/** Elapsed / budget (m:ss / mm:00) from when the running round started, ticking every
 *  second. Turns red and announces once elapsed passes the round's timeout. */
function ElapsedTimer({
  since,
  timeoutMinutes,
}: {
  since: string | undefined;
  timeoutMinutes: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, []);
  const start = since ? Date.parse(since) : NaN;

  if (Number.isNaN(start)) {
    return null;
  }
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const over = secs > timeoutMinutes * 60;

  return (
    <span
      role="timer"
      aria-live="polite"
      aria-label={`Elapsed ${formatSeconds(secs)} of a ${timeoutMinutes} minute budget`}
      title={
        over ? "This planning round has exceeded its time budget" : undefined
      }
      className="meta"
      style={{
        marginLeft: 8,
        fontVariantNumeric: "tabular-nums",
        color: over ? "var(--danger)" : undefined,
      }}
    >
      · {formatSeconds(secs)} / {timeoutMinutes}:00
    </span>
  );
}

const PRE_STYLE: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 220,
  overflow: "auto",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 10,
  fontSize: "var(--fs-xs)",
  marginTop: 8,
};

export default function RunningCard({
  iteration,
  since,
  timeoutMinutes,
  liveOutput,
  run,
  phase = "round",
}: {
  iteration: number;
  since: string | undefined;
  timeoutMinutes: number;
  liveOutput?: string | null;
  run?: FeatureRunPayload | null;
  /** Which half of the line is working: a planning ROUND, or the SPEC work that
   *  follows the author's accept. Both run on the same line and get the same card —
   *  before this the spec phase showed a row of disabled buttons and no graph. */
  phase?: "round" | "spec";
}) {
  const spec = phase === "spec";

  return (
    <div className="spec-card">
      <p style={{ display: "flex", alignItems: "center", margin: 0 }}>
        {spec
          ? "Writing the spec — deciding which specs change, then writing them…"
          : `Analyzing your feature against the project… (round ${iteration})`}
        <span className="planning-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <ElapsedTimer since={since} timeoutMinutes={timeoutMinutes} />
      </p>
      <p className="meta">
        {spec
          ? "The spec PR opens when this finishes. This refreshes automatically."
          : "The planning agent is running. This refreshes automatically."}
      </p>
      {run && (
        <RunVisualizationPanel
          runId={run.id}
          runStatus={run.status}
          startedAt={run.startedAt}
          definition={run.definition}
          showEdgeLabels={!run.synthetic}
          nodes={run.nodes}
          repo={run.repo}
          reason={run.reason}
        />
      )}
      {liveOutput && <pre style={PRE_STYLE}>{liveOutput}</pre>}
    </div>
  );
}
