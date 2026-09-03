"use client";

import CollapsibleCard from "@/components/CollapsibleCard";
import RunGraphView from "@/app/assembly-runs/[id]/RunGraphView";
import { isTerminalRunStatus } from "@/app/assembly-runs/[id]/run-stream-presenter";
import { deriveVisibleGraph } from "@/lib/graph-view-model";
import { walkRunData } from "@/lib/run-walk-data";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";

/** Narrowed to what the graph needs; TYPE-ONLY import of the node row since a value import from feature-run.ts drags its db → pg chain into the browser bundle. */
export interface AssemblyRunSummary {
  status: string;
  nodes: readonly AssemblyRunNode[];
}

// With a run, draws the CURRENT STATE (status per step, walked hops bold); without one, falls back to the declared graph as a preview, not a claim.
export function FeatureAssemblyLine({
  definition,
  run = null,
  title = "How planning works",
}: {
  definition: AssemblyLineDefinition | null;
  run?: AssemblyRunSummary | null;
  title?: string;
}) {
  if (!definition) {
    return null;
  }

  const runData = run
    ? walkRunData(definition, run.nodes, isTerminalRunStatus(run.status))
    : null;

  return (
    <CollapsibleCard title={title} hint={definition.description} defaultOpen>
      <p className="meta">Assembly line: {definition.name}</p>
      <RunGraphView
        graph={deriveVisibleGraph(
          definition,
          runData,
          runData ? "run" : "definition",
        )}
        definition={definition}
        heading={null}
      />
    </CollapsibleCard>
  );
}
