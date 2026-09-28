"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";

export interface RestartClusterButtonProps {
  /** The bound server action — the agent id is applied server-side. */
  restart: () => Promise<void>;
}

/** Central cluster restart (pulls latest); needs confirmation (kills mid-process). */
export default function RestartClusterButton({
  restart,
}: RestartClusterButtonProps) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <ConfirmRow
        pending={pending}
        onConfirm={() => confirmedRestart(restart, setPending)}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <button className="button" onClick={() => setConfirming(true)}>
      Restart
    </button>
  );
}

async function confirmedRestart(
  restart: () => Promise<void>,
  setPending: (pending: boolean) => void,
): Promise<void> {
  setPending(true);

  try {
    await restart();
  } finally {
    setPending(false);
  }
}

interface ConfirmRowProps {
  pending: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** The second click. A restart kills whatever the cluster is running mid-process, so it is confirmed rather than fired from one press. Cancel is disabled off the same `pending` the confirm button drives, so it can't be clicked mid-restart. */
function ConfirmRow({ pending, onConfirm, onCancel }: ConfirmRowProps) {
  return (
    <>
      <PendingActionButton
        action={onConfirm}
        text="Confirm restart"
        pendingText="Restarting…"
        className="button"
      />{" "}
      <button className="button" disabled={pending} onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
