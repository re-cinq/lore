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
      <>
        <button
          className="button"
          disabled={pending}
          onClick={() => startTransition(() => restart())}
        >
          Confirm restart
        </button>{" "}
        <button
          className="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </>
    );
  }

  return (
    <button className="button" onClick={() => setConfirming(true)}>
      Restart
    </button>
  );
}
