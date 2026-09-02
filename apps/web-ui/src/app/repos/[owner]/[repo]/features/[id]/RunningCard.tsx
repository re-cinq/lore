"use client";

import { Alert } from "@/components/Alert";
import { useEffect, useState } from "react";
import styles from "./RunningCard.module.scss";
import { formatSeconds } from "@/lib/format-time";
import { nodeBudgetMinutes } from "@/lib/node-budget";
import { formatTokens, type RunTokens } from "@/lib/run-tokens";
import RunVisualizationPanel from "@/app/assembly-runs/[id]/RunVisualizationPanel";
import type { FeatureRunPayload } from "@/lib/feature-run";

/** Elapsed / budget (m:ss / mm:00) from when the working node started, ticking every
 *  second. Turns red once elapsed passes the budget — which is the deadline the
 *  assembly-line reaper actually kills the node at, not a decorative target. */
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

/** What the run has spent so far. Rendered only once something has been reported:
 *  a "0 tokens" badge on a pod that has not streamed its first turn yet says
 *  "nothing is happening", which is the opposite of true. */
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
  /** Fallback budget for a feature that resolves no line — a legacy feature minted
   *  a task per round and has no definition to read a per-node deadline from. */
  timeoutMinutes: number;
  /** The node the line is working, which is what owns the real deadline. */
  nodeId?: string;
  liveOutput?: string | null;
  run?: FeatureRunPayload | null;
  /** Which half of the line is working: a planning ROUND, or the SPEC work that
   *  follows the author's accept. Both run on the same line and get the same card —
   *  before this the spec phase showed a row of disabled buttons and no graph. */
  phase?: "round" | "spec";
}) {
  const spec = phase === "spec";
  // The node's own deadline when the line can name one; the round's budget only for
  // a feature with no line to read.
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
