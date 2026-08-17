"use client";

import CollapsibleCard from "@/components/CollapsibleCard";
import RunGraphView from "@/app/assembly-runs/[id]/RunGraphView";
import { isTerminalRunStatus } from "@/app/assembly-runs/[id]/run-stream-presenter";
import { deriveVisibleGraph } from "@/lib/graph-view-model";
import { walkRunData } from "@/lib/run-walk-data";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyLineRunNode } from "@/lib/assembly-line-runs";

/** The run to draw, narrowed to what the graph needs. A TYPE-ONLY import of the
 *  node row on purpose: a value import from feature-run.ts drags its db → pg chain
 *  into the browser bundle (see feature-phase.ts). */
export interface AssemblyLineRunSummary {
  status: string;
  nodes: readonly AssemblyLineRunNode[];
}

// The machine behind the planning pages, shown on both of them: what "Start
// planning" sets in motion, and where the feature's own line has got to.
//
// With a run it draws the CURRENT STATE — every step named with its status, the
// hops the walk took bold, the rest faded. Without one (the create page, or a
// feature whose line has not been resolved) it falls back to the declared graph,
// which is a preview rather than a claim about a run that does not exist.
//
// `definition` and `run` are both fetched server-side and passed down, so this
// stays a pure view (lore/no-io-in-view) and an unreachable Floor costs a preview
// rather than the form it sits above.
export function FeatureAssemblyLine({
  definition,
  run = null,
  title = "How planning works",
}: {
  definition: AssemblyLineDefinition | null;
  run?: AssemblyLineRunSummary | null;
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
