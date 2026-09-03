"use client";

import { useTransition } from "react";

export interface PauseClusterButtonProps {
  paused: boolean;
  /** The bound server action — the agent id is applied server-side. */
  toggle: (paused: boolean) => Promise<void>;
}

/** Cluster pause switch: client useTransition with bound server action (FR9). */
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
