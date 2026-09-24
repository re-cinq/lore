"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRunChannel } from "@/app/assembly-runs/[id]/useRunChannel";
import type { RunStreamFrame } from "@/lib/run-stream-types";

interface PlanRunFollowerProps {
  runId: string;
  /** The run is still open; a settled run has nothing left to announce. */
  live: boolean;
}

// The frames that move a plan page's state: a node opening or settling, the run ending, the task changing. Agent events are the transcript's business.
const MOVING: ReadonlySet<RunStreamFrame["type"]> = new Set([
  "node_status",
  "run_status",
  "task_event",
]);

// One re-read per burst: an open replays every node's snapshot at once, and a settling node fires two frames back to back.
const SETTLE_MS = 300;

/** Follows the plan's run on the tab's live socket and re-reads the page when the line moves, so the state, the question and the spec PR arrive without a reload. Renders nothing. */
export default function PlanRunFollower({ runId, live }: PlanRunFollowerProps) {
  const refresh = useSettledRefresh(SETTLE_MS);

  useRunChannel({
    runId,
    afterId: "0",
    enabled: live,
    onFrame: (frame) => MOVING.has(frame.type) && refresh(),
    onConnectionChange: () => undefined,
  });

  return null;
}

function useSettledRefresh(settleMs: number): () => void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => router.refresh(), settleMs);
  };
}
