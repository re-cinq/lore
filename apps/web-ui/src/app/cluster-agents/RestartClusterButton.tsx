"use client";

import { useState, useTransition } from "react";

export interface RestartClusterButtonProps {
  /** The bound server action — the agent id is applied server-side. */
  restart: () => Promise<void>;
}

/** Central cluster restart (pulls latest); needs confirmation (kills mid-process). */
export default function RestartClusterButton({
  restart,
}: RestartClusterButtonProps) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <ConfirmRow
        pending={pending}
        onConfirm={() => startTransition(() => restart())}
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

/** The second click. A restart kills whatever the cluster is running mid-process, so it is confirmed rather than fired from one press. */
function ConfirmRow({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <button className="button" disabled={pending} onClick={onConfirm}>
        Confirm restart
      </button>{" "}
      <button className="button" disabled={pending} onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
