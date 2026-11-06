"use client";

import { useRunsChannel } from "@/app/assembly-runs/useRunsChannel";
import { useSettledRefresh } from "@/lib/live-socket/use-settled-refresh";
import type { RunListFrame } from "@/lib/live-socket/protocol";

interface LoopRunsFollowerProps {
  /** The run ids the page's tickets currently show a pipeline for. */
  runIds: readonly string[];
}

// One re-read per 10 s at most: each one re-reads every shown loop, and a busy floor sends frames all the time.
const REFRESH_EVERY_MS = 10_000;

/** Follows the backlog's tickets on the tab's live socket and re-reads the page when one of their runs changes, so the Stages column updates without a reload. Renders nothing. */
export default function LoopRunsFollower({ runIds }: LoopRunsFollowerProps) {
  const refresh = useSettledRefresh(REFRESH_EVERY_MS);

  useRunsChannel({
    runIds,
    onFrame: (frame: RunListFrame) => frame.type !== "run_started" && refresh(),
    onConnectionChange: () => undefined,
  });

  return null;
}
