"use client";

/**
 * Keeps a LIVE run's page current with the server. The page is server-rendered
 * — header status, options, the panel's seed node rows — and the SSE stream
 * carries only agent EVENTS, deliberately not node state (ADR-037: node state
 * seeds from `pipeline.station_runs`). So a recorded outcome, a new visit row
 * or the run turning terminal only appeared on a manual reload. While the run
 * is non-terminal this re-runs the server component on a cadence
 * (`router.refresh()`, the PlanningWizard's idiom); client state — the stream,
 * the selection, the scrubber — survives the refresh. A terminal run renders
 * nothing and refreshes nothing: its snapshot is the truth.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isTerminalRunStatus } from "./run-stream-presenter";

export const RUN_REFRESH_INTERVAL_MS = 10_000;

export function RunAutoRefresh({ runStatus }: { runStatus: string }) {
  const router = useRouter();
  const live = !isTerminalRunStatus(runStatus);

  useEffect(() => {
    if (!live) {
      return;
    }
    const handle = setInterval(() => router.refresh(), RUN_REFRESH_INTERVAL_MS);

    return () => clearInterval(handle);
  }, [live, router]);

  return null;
}
