"use client";

// The run's facts card with its bag (run-viz FR4.4n). The facts come from the page's live run; the bag is the floor's, read through the session-authed proxy once on mount and again whenever the page's live state says the run or a node moved, because a visit finishing is exactly when it gains an item. A failed read keeps the bag already shown.
import { useEffect, useState } from "react";
import type { AssemblyRun, AssemblyRunNode } from "@/lib/assembly-runs";
import { readRunBag, type RunBag } from "@/lib/run-bag";
import { RunFacts } from "./AssemblyRunView";

export interface RunFactsCardProps {
  run: AssemblyRun;
  /** Changes when the run or one of its nodes changed; each change re-reads the bag. */
  refreshKey: string;
  /** The run's attempts, which name who put each bag item there. */
  nodes?: readonly AssemblyRunNode[];
}

export default function RunFactsCard({
  run,
  refreshKey,
  nodes,
}: RunFactsCardProps) {
  const bag = useRunBag(run.id, refreshKey);

  return <RunFacts run={run} bag={bag} nodes={nodes} />;
}

/** The latest bag, or null until one has been read. A newer read cancels the one in flight, so a slow old answer can neither pile up behind it nor land after it. */
function useRunBag(runId: string, refreshKey: string): RunBag | null {
  const [bag, setBag] = useState<RunBag | null>(null);

  useEffect(() => {
    const read = new AbortController();

    readRunBag(runId, read.signal)
      .then((next) => {
        if (next !== null && !read.signal.aborted) {
          setBag(next);
        }
      })
      .catch(() => {});

    return () => read.abort();
  }, [runId, refreshKey]);

  return bag;
}
