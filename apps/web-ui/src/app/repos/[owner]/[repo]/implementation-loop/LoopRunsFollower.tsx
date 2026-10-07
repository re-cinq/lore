"use client";

import { useRunsChannel } from "@/app/assembly-runs/useRunsChannel";
import { useSettledRefresh } from "@/lib/live-socket/use-settled-refresh";
import type { RunListFrame } from "@/lib/live-socket/protocol";

interface LoopRunsFollowerProps {
  /** The run ids the page's tickets currently show a pipeline for. */
  runIds: readonly string[];
}

// One re-read per burst: a node settling can fire more than one run_row frame back to back.
const SETTLE_MS = 300;

/** Follows the backlog's tickets on the tab's live socket and re-reads the page when one of their runs changes, so the Stages column updates without a reload. Renders nothing. */
export default function LoopRunsFollower({ runIds }: LoopRunsFollowerProps) {
  const refresh = useSettledRefresh(SETTLE_MS);

  useRunsChannel({
    runIds,
    onFrame: (frame: RunListFrame) => frame.type !== "run_started" && refresh(),
    onConnectionChange: () => undefined,
  });

  return null;
}
