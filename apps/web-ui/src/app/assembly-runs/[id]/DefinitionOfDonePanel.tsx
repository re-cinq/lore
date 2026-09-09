"use client";

// Reads the run's Definition of Done through the session-authed proxy (specs/implementation-loop FR16): once on mount, and again whenever the page's live state says the run or its CI checks moved — the count is only as fresh as the last CI report, so a check webhook is exactly when to look again.
import { useEffect, useState } from "react";
import type { DodProgress } from "@/lib/dod-progress-view";
import DefinitionOfDoneView from "./DefinitionOfDoneView";

export interface DefinitionOfDonePanelProps {
  runId: string;
  /** Changes when the run status or the CI check changed; each change re-reads the progress. */
  refreshKey: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function readProgress(runId: string): Promise<DodProgress | null> {
  const res = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/dod`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as DodProgress;
}

/** The latest progress, or null while loading or after a failed read; a disposed panel is told nothing. */
function useDodProgress(runId: string, refreshKey: string) {
  const [progress, setProgress] = useState<DodProgress | null>(null);

  useEffect(() => {
    let disposed = false;

    readProgress(runId)
      .then((next) => {
        if (!disposed && next !== null) {
          setProgress(next);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, [runId, refreshKey]);

  return progress;
}

export default function DefinitionOfDonePanel({
  runId,
  refreshKey,
}: DefinitionOfDonePanelProps) {
  const progress = useDodProgress(runId, refreshKey);

  if (progress === null) {
    return null;
  }

  return <DefinitionOfDoneView progress={progress} />;
}
