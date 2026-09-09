"use client";

import { Alert } from "@/components/Alert";
import { useEffect, useState } from "react";
import styles from "./RunningCard.module.scss";
import { formatSeconds } from "@/lib/format-time";
import { nodeBudgetMinutes } from "@/lib/node-budget";
import { formatTokens, type RunTokens } from "@/lib/run-tokens";
import RunVisualizationPanel from "@/app/assembly-runs/[id]/RunVisualizationPanel";
import type { FeatureRunPayload } from "@/lib/feature-run";

/** Seconds since `since`, ticking every second, or null when there is no parseable start. The interval runs regardless so the hook order never changes between renders. */
function useElapsedSeconds(since: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, []);
  const start = since ? Date.parse(since) : NaN;

  return Number.isNaN(start)
    ? null
    : Math.max(0, Math.floor((now - start) / 1000));
}

/** The timer itself, once there is a count to show. Over budget it says so in both the styling and the tooltip, since the styling alone does not explain what happens next. */
interface TimerReadoutProps {
  secs: number;
  timeoutMinutes: number;
}

function TimerReadout({ secs, timeoutMinutes }: TimerReadoutProps) {
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

/** Elapsed/budget timer ticking every second; turns red when deadline (reaper's kill time) passes. */
function ElapsedTimer({
  since,
  timeoutMinutes,
}: {
  since: string | undefined;
  timeoutMinutes: number;
}) {
  const secs = useElapsedSeconds(since);

  // A start time that will not parse means there is nothing to count from; no timer beats a timer counting from zero.
  if (secs === null) {
    return null;
  }

  return <TimerReadout secs={secs} timeoutMinutes={timeoutMinutes} />;
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

function statusText(spec: boolean, iteration: number): string {
  return spec
    ? "Writing the spec — deciding which specs change, then writing them…"
    : `Analyzing your feature against the project… (round ${iteration})`;
}

function refreshHint(spec: boolean): string {
  return spec
    ? "The spec PR opens when this finishes. This refreshes automatically."
    : "The planning agent is running. This refreshes automatically.";
}

function effectiveBudget(
  run: FeatureRunPayload | null | undefined,
  nodeId: string | undefined,
  timeoutMinutes: number,
): number {
  return nodeBudgetMinutes(run?.definition, nodeId) ?? timeoutMinutes;
}

function RunGraph({ run }: { run: FeatureRunPayload | null | undefined }) {
  if (!run) {
    return null;
  }

  return (
    <RunVisualizationPanel
      runId={run.id}
      runStatus={run.status}
      definition={run.definition}
      nodes={run.nodes}
      repo={run.repo}
      reason={run.reason}
    />
  );
}

interface RunningCardProps {
  iteration: number;
  since: string | undefined;
  /** Fallback budget for legacy features with no definition to read a per-node deadline from. */
  timeoutMinutes: number;
  /** The node the line is working; it owns the real deadline. */
  nodeId?: string;
  liveOutput?: string | null;
  run?: FeatureRunPayload | null;
  /** A planning ROUND or the SPEC work following the author's accept; both run on the same line and get the same card. */
  phase?: "round" | "spec";
}

interface StatusLineProps {
  spec: boolean;
  iteration: number;
  since: string | undefined;
  budget: number;
  tokens: RunTokens | null | undefined;
}

/** What the line is doing, how long it has been doing it, and what it has spent — one line, because that is how it is read. */
function RunningStatusLine(props: StatusLineProps) {
  const { spec, iteration, since, budget, tokens } = props;

  return (
    <p className={styles.status}>
      {statusText(spec, iteration)}
      <span className="planning-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <ElapsedTimer since={since} timeoutMinutes={budget} />
      <TokenCount tokens={tokens} />
    </p>
  );
}

export default function RunningCard(props: RunningCardProps) {
  const { iteration, since, nodeId, liveOutput, run } = props;
  const spec = props.phase === "spec";
  // Node's deadline when line names one; round's budget only for features with no line.
  const budget = effectiveBudget(run, nodeId, props.timeoutMinutes);

  return (
    <div className="spec-card">
      <RunningStatusLine
        spec={spec}
        iteration={iteration}
        since={since}
        budget={budget}
        tokens={run?.tokens}
      />
      <Alert>{refreshHint(spec)}</Alert>
      <RunGraph run={run} />
      {liveOutput && <pre className={styles.output}>{liveOutput}</pre>}
    </div>
  );
}
