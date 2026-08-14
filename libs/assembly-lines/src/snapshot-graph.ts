// Converting a blueprint into the graph one run carries a copy of
// (specs/6-dark-factory FR6.38).
//
// The clone exists so a run stops depending on a FILE that can change under it:
// `advanceLine` used to re-read the YAML off the Floor's image at every step, so
// editing a definition changed the graph mid-walk, and a renamed or deleted one
// left its own history undrawable.
//
// Two things happen here that do not happen anywhere downstream:
//
//   * the Station is RESOLVED, once. An agent node with no `station_ref` runs the
//     recipe named after its LINE, and re-deriving that at every call site is how
//     three nodes on the planning line silently ran the planning prompt and
//     reported success. `station_inherited` keeps the fact that it was inherited,
//     because that is the case that becomes wrong when a node is reused.
//   * the result is a FAITHFUL copy — the blueprint's own field names, plus the
//     resolved station. Renaming them into another convention would buy nothing
//     and cost a translation layer on every read; keeping them means the walk
//     (`nextTransition`) consumes a stored graph and a freshly loaded one through
//     the same structural type. `libs/shared` mirrors this shape as `RunGraph`
//     rather than importing it, since that package cannot depend on this one.

import type { AssemblyLine } from "./loader.js";
import { resolveNodeStation } from "./node-station.js";

/** One node, as a run records it. Mirrors `RunGraph` in `@re-cinq/lore-shared`. */
export interface SnapshotNode {
  id: string;
  type: string;
  /** Resolved once, here — see the header. */
  station: string | null;
  station_inherited: boolean;
  route?: string;
  prompt_ref?: string;
  model?: string;
  timeout_minutes?: number;
  /** Station knobs — `nodeStationSpec` passes these through as pod params, so a
   *  clone that dropped them would dispatch a station with no input. */
  validator?: string;
  condition_ref?: string;
  job_ref?: string;
  /** Which prior run this node continues, and which thread it belongs to — the
   *  conversation seam (FR6.24). Dropped from the clone, a resumed round would
   *  silently start a fresh conversation and still succeed. */
  continues?: { node: string; key: string };
  description?: string;
}

export interface SnapshotEdge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

export interface SnapshotGraph {
  name: string;
  entry: string;
  exit: string;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

/**
 * The blueprint as a run will record it.
 *
 * `lineTaskType` is what an inherited Station is named after — the run's blueprint
 * name in every current caller, passed explicitly because the resolution rule is
 * the caller's context, not a property of the graph.
 *
 * Optional fields are OMITTED rather than set to null: the result is stored as
 * jsonb and read back structurally, and `{}` for an absent field survives a JSON
 * round-trip identically while keeping the stored rows small.
 */
export function snapshotGraph(
  definition: AssemblyLine,
  lineTaskType: string,
): SnapshotGraph {
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
        ...(node.validator ? { validator: node.validator } : {}),
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
