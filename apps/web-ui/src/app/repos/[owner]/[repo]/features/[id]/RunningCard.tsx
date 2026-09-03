"use client";

import { Alert } from "@/components/Alert";
import { useEffect, useState } from "react";
import styles from "./RunningCard.module.scss";
import { formatSeconds } from "@/lib/format-time";
import { nodeBudgetMinutes } from "@/lib/node-budget";
import { formatTokens, type RunTokens } from "@/lib/run-tokens";
import RunVisualizationPanel from "@/app/assembly-runs/[id]/RunVisualizationPanel";
import type { FeatureRunPayload } from "@/lib/feature-run";

/** Elapsed/budget timer ticking every second; turns red when deadline (reaper's kill time) passes. */
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
      aria-label={`Elapsed ${formatSeconds(secs)} of the ${timeoutMinutes} minutes this step has before it is stopped`}
      title={
        over
          ? "Past its budget — the reaper stops a node that overruns"
          : undefined
      }
      className={`meta ${styles.counter} ${over ? styles.overBudget : ""}`}
    >
      · {formatSeconds(secs)} / {timeoutMinutes}:00
    </span>
  );
}

/** Run's spent tokens; omit "0 tokens" on pod that hasn't streamed first turn yet. */
function TokenCount({ tokens }: { tokens: RunTokens | null | undefined }) {
  if (!tokens) {
    return null;
  }

  return (
    <span
      className={`meta ${styles.counter}`}
      title={`${tokens.input.toLocaleString()} prompt (including cached) + ${tokens.output.toLocaleString()} completion`}
    >
      · {formatTokens(tokens.total)} tokens
    </span>
  );
}

export default function RunningCard({
  iteration,
  since,
  timeoutMinutes,
  nodeId,
  liveOutput,
  run,
  phase = "round",
}: {
  iteration: number;
  since: string | undefined;
  /** Fallback budget for legacy features with no definition to read per-node deadline. */
  timeoutMinutes: number;
  /** The node the line is working; owns the real deadline. */
  nodeId?: string;
  liveOutput?: string | null;
  run?: FeatureRunPayload | null;
  /** Planning ROUND or SPEC work following author's accept; both run on same line and get same card. */
  phase?: "round" | "spec";
}) {
  const spec = phase === "spec";
  // Node's deadline when line names one; round's budget only for features with no line.
  const budget = nodeBudgetMinutes(run?.definition, nodeId) ?? timeoutMinutes;

  return (
    <div className="spec-card">
      <p className={styles.status}>
        {spec
          ? "Writing the spec — deciding which specs change, then writing them…"
          : `Analyzing your feature against the project… (round ${iteration})`}
        <span className="planning-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <ElapsedTimer since={since} timeoutMinutes={budget} />
        <TokenCount tokens={run?.tokens} />
      </p>
      <Alert>
        {spec
          ? "The spec PR opens when this finishes. This refreshes automatically."
          : "The planning agent is running. This refreshes automatically."}
      </Alert>
      {run && (
        <RunVisualizationPanel
          runId={run.id}
          runStatus={run.status}
          startedAt={run.startedAt}
          definition={run.definition}
          nodes={run.nodes}
          repo={run.repo}
          reason={run.reason}
        />
      )}
      {liveOutput && <pre className={styles.output}>{liveOutput}</pre>}
    </div>
  );
}
