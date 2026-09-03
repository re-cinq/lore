// Converts a blueprint into the graph one run carries a copy of (specs/6-dark-factory FR6.38), so a run stops depending on a FILE that can change under it (advanceLine used to re-read the YAML at every step). Resolves the Station once here (station_inherited flags when re-deriving it per-call would let a reused node silently run the wrong recipe, as happened on the planning line) and produces a FAITHFUL copy — the blueprint's own field names plus the resolved station — using the shared `RunGraph` type rather than a hand-mirror that can drift.

import type { AssemblyLine } from "./loader.js";
import { resolveNodeStation } from "./node-station.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

// The blueprint as a run will record it. `lineTaskType` (what an inherited Station names after) is passed explicitly since the resolution rule is the caller's context, not a graph property. Optional fields are OMITTED (not null) since `{}` survives a jsonb round-trip identically while keeping stored rows small.
export function snapshotGraph(
  definition: AssemblyLine,
  lineTaskType: string,
): RunGraph {
  return {
    name: definition.name,
    entry: definition.entry,
    exit: definition.exit,
    nodes: definition.nodes.map((node) => {
      const { station, inherited } = resolveNodeStation(node, lineTaskType);

      return {
        id: node.id,
        type: node.type,
        station,
        station_inherited: inherited,
        ...(node.prompt_ref ? { prompt_ref: node.prompt_ref } : {}),
        ...(node.model ? { model: node.model } : {}),
        ...(node.timeout_minutes
          ? { timeout_minutes: node.timeout_minutes }
          : {}),
        ...(node.required_tags
          ? { required_tags: [...node.required_tags] }
          : {}),
        ...(node.condition_ref ? { condition_ref: node.condition_ref } : {}),
        ...(node.job_ref ? { job_ref: node.job_ref } : {}),
        ...(node.route ? { route: node.route } : {}),
        ...(node.continues ? { continues: { ...node.continues } } : {}),
        ...(node.description ? { description: node.description } : {}),
      };
    }),
    edges: definition.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      on: edge.on,
      ...(edge.iteration_max ? { iteration_max: edge.iteration_max } : {}),
    })),
  };
}
