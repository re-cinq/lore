"use client";

import PendingActionButton from "@/components/PendingActionButton";

export interface PauseClusterButtonProps {
  paused: boolean;
  /** The bound server action — the agent id is applied server-side. */
  toggle: (next: { paused: boolean }) => Promise<void>;
}

/** Cluster pause switch: bound server action, awaited end-to-end by the button (FR9). */
export default function PauseClusterButton({
  paused,
  toggle,
}: PauseClusterButtonProps) {
  return (
    <PendingActionButton
      action={() => toggle({ paused: !paused })}
      text={paused ? "Resume" : "Pause"}
      pendingText={paused ? "Resuming…" : "Pausing…"}
      className=""
    />
  );
}
