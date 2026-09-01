"use client";

import { useState, useTransition } from "react";

export interface RestartClusterButtonProps {
  /** The bound server action — the agent id is applied server-side. */
  restart: () => Promise<void>;
}

/**
 * Bounces the central cluster-agent so it re-pulls `latest` on restart
 * (pullPolicy: Always). Only rendered for the central row — lore-api dials one
 * static in-cluster address and has no path into a satellite.
 *
 * Client only for `useTransition`; the write itself is the bound server action
 * the page hands down, so the browser never names which cluster it restarts.
 *
 * A restart kills whatever the process is mid-way through, unlike Pause, so a
 * stray click needs a second one to confirm before it fires.
 */
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
