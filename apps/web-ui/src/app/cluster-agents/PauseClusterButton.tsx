"use client";

import { useTransition } from "react";

export interface PauseClusterButtonProps {
  paused: boolean;
  /** The bound server action — the agent id is applied server-side. */
  toggle: (paused: boolean) => Promise<void>;
}

/**
 * The operator's stop switch for one cluster (FR9 of
 * specs/running-stations-in-any-k8s-cluster).
 *
 * Client only for `useTransition`; the write itself is the bound server action
 * the page hands down, so the browser never names which cluster it is pausing.
 */
export default function PauseClusterButton({
  paused,
  toggle,
}: PauseClusterButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="button"
      disabled={pending}
      onClick={() => startTransition(() => toggle(!paused))}
    >
      {paused ? "Resume" : "Pause"}
    </button>
  );
}
