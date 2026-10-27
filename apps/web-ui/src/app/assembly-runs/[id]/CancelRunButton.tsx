"use client";

// "Cancel run": cancels an open floor run that has no task to cancel, behind the same confirm step as "Cancel Task". `*Button.tsx` keeps this exempt from no-io-in-view.
import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import { useRefreshingAction } from "@/components/useRefreshingAction";
import type { components } from "@/lib/api/schema";
import styles from "./CancelTaskButton.module.scss";

type CancelAnswer = Partial<components["schemas"]["AssemblyRunCancelled"]> & {
  error?: string;
};

export function CancelRunButton({ runId }: { runId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="danger"
        onClick={() => setConfirming(true)}
      >
        Cancel run
      </button>
    );
  }

  return <CancelRunConfirm runId={runId} onKeep={() => setConfirming(false)} />;
}

interface CancelRunConfirmProps {
  runId: string;
  onKeep: () => void;
}

/** The confirm step: the ask, the page refresh once the floor took it, and the refusal shown beside the buttons. */
function CancelRunConfirm({ runId, onKeep }: CancelRunConfirmProps) {
  const { error, pending, run } = useRefreshingAction(() => askToCancel(runId));

  return (
    <span className={styles.confirm}>
      <span>Cancel this run?</span>
      <PendingActionButton
        action={run}
        text="Confirm cancel"
        pendingText="Cancelling…"
        pending={pending}
        className="danger"
      />
      <button type="button" onClick={onKeep} disabled={pending}>
        Keep run
      </button>
      {error ? <span className="meta">{error}</span> : null}
    </span>
  );
}

async function askToCancel(runId: string): Promise<CancelAnswer> {
  const res = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST", signal: AbortSignal.timeout(30_000) },
  );
  const answer = (await res.json()) as CancelAnswer;

  return res.ok
    ? answer
    : { error: answer.error ?? `cancel failed (${res.status})` };
}
