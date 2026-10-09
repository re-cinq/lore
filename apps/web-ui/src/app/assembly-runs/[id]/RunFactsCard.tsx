"use client";

// The run's facts card with its bag (run-viz FR4.4n). The facts come from the page's live run; the bag is the floor's, read through the session-authed proxy once on mount and again whenever the page's live state says the run or a node moved, because a visit finishing is exactly when it gains an item. A failed read keeps the bag already shown.
import { useEffect, useState } from "react";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { readRunBag, type RunBag } from "@/lib/run-bag";
import { RunFacts } from "./AssemblyRunView";

export interface RunFactsCardProps {
  run: AssemblyRun;
  /** Changes when the run or one of its nodes changed; each change re-reads the bag. */
  refreshKey: string;
}

export default function RunFactsCard({ run, refreshKey }: RunFactsCardProps) {
  const bag = useRunBag(run.id, refreshKey);

  return <RunFacts run={run} bag={bag} />;
}

/** The latest bag, or null until one has been read; a disposed card is told nothing. */
function useRunBag(runId: string, refreshKey: string): RunBag | null {
  const [bag, setBag] = useState<RunBag | null>(null);

  useEffect(() => {
    let disposed = false;

    readRunBag(runId)
      .then((next) => {
        if (!disposed && next !== null) {
          setBag(next);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, [runId, refreshKey]);

  return bag;
}
