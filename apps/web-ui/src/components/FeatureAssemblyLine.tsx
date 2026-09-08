"use client";

import CollapsibleCard from "@/components/CollapsibleCard";
import RunGraphView from "./RunGraphView";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import { deriveVisibleGraph } from "@/lib/graph-view-model";
import { walkRunData } from "@/lib/run-walk-data";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";

/** Narrowed to what the graph needs; TYPE-ONLY import of the node row since a value import from feature-run.ts drags its db → pg chain into the browser bundle. */
export interface AssemblyRunSummary {
  status: string;
  nodes: readonly AssemblyRunNode[];
}

type RunData = ReturnType<typeof walkRunData> | null;

interface FeatureAssemblyLineProps {
  definition: AssemblyLineDefinition | null;
  run?: AssemblyRunSummary | null;
  title?: string;
}

/** The graph itself, drawn from the walk when there is one and from the declaration otherwise. */
function LineGraph({
  definition,
  runData,
}: {
  definition: AssemblyLineDefinition;
  runData: RunData;
}) {
  return (
    <RunGraphView
      graph={deriveVisibleGraph(
        definition,
        runData,
        runData ? "run" : "definition",
      )}
      definition={definition}
      heading={null}
    />
  );
}

// With a run, draws the CURRENT STATE (status per step, walked hops bold); without one, falls back to the declared graph as a preview, not a claim.
export function FeatureAssemblyLine({
  definition,
  run = null,
  title = "How planning works",
}: FeatureAssemblyLineProps) {
  if (!definition) {
    return null;
  }

  const runData = run
    ? walkRunData(definition, run.nodes, isTerminalRunStatus(run.status))
    : null;

  return (
    <CollapsibleCard title={title} hint={definition.description} defaultOpen>
      <p className="meta">Assembly line: {definition.name}</p>
      <LineGraph definition={definition} runData={runData} />
    </CollapsibleCard>
  );
}
