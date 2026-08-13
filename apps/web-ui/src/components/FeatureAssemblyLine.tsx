"use client";

import CollapsibleCard from "@/components/CollapsibleCard";
import RunGraphView from "@/app/assembly-lines/[id]/RunGraphView";
import { deriveVisibleGraph } from "@/lib/graph-view-model";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

// The machine behind the planning pages, shown on both of them: what "Start
// planning" sets in motion, and which line this feature is running on. The author
// can see there is a human step (`author`) and a wait for the spec PR (`merged`)
// before anything is filed.
//
// The DECLARED graph, not a live walk — the wizard already renders live node state
// through RunningCard, and duplicating that here would mean two graphs disagreeing
// on the same page. `definition` is fetched server-side and passed down, so this
// stays a pure view (lore/no-io-in-view) and an unreachable Floor costs a preview
// rather than the form it sits above.
export function FeatureAssemblyLine({
  definition,
  title = "How planning works",
}: {
  definition: AssemblyLineDefinition | null;
  title?: string;
}) {
  if (!definition) {
    return null;
  }

  return (
    <CollapsibleCard title={title} hint={definition.description} defaultOpen>
      <p className="meta">{definition.name}</p>
      <RunGraphView
        graph={deriveVisibleGraph(definition, null, "definition")}
        definition={definition}
        heading={null}
      />
    </CollapsibleCard>
  );
}
