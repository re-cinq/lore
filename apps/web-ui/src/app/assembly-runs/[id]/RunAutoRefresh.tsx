"use client";

// Keeps a LIVE run's server-rendered page current via router.refresh() on a cadence (SSE carries no node state, ADR-037); client state survives the refresh. A terminal run refreshes nothing — its snapshot is the truth.
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
