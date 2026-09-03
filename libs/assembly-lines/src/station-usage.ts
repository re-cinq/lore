// Which catalog entries the blueprints actually dispatch.
//
// The catalog (lore.agent_definitions) is the roster and the blueprints are one
// consumer of it — a definition can exist with no node referencing it (a
// blueprint-less task type like runbook runs as a single Agent CR, and a seeded
// station can be dormant). This walk answers the other direction: for every
// station a node resolves to, WHERE is it used, so the /agents UI can show a
// definition's references instead of leaving "is this dead?" to grep.
//
// Service-form nodes (their pooled station manifest says runtime: "service")
// resolve to def-<type> names that have no catalog row at all; they fall out
// naturally when the caller joins this map against the definitions list.

import type { AssemblyLine } from "./loader.js";
import { resolveNodeStation } from "./node-station.js";

export interface StationUsageRef {
  /** The blueprint (assembly-line definition) whose node dispatches it. */
  blueprint: string;
  nodeId: string;
  /** True when the name came from the node's type or its line, not the node —
   *  the reference that silently changes when a node is reused on another line. */
  inherited: boolean;
}

/**
 * Every station name any blueprint node resolves to, with the nodes that
 * resolve there. Human nodes dispatch nothing and are skipped.
 */
export function stationUsage(
  definitions: ReadonlyMap<string, AssemblyLine>,
): Map<string, StationUsageRef[]> {
  const usage = new Map<string, StationUsageRef[]>();
  const blueprintNodes = [...definitions].flatMap(([blueprint, definition]) =>
    definition.nodes.map((node) => ({ blueprint, node })),
  );

  for (const { blueprint, node } of blueprintNodes) {
    const { station, inherited } = resolveNodeStation(node, blueprint);

    if (station === null) {
      continue;
    }
    const refs = usage.get(station) ?? [];

    refs.push({ blueprint, nodeId: node.id, inherited });
    usage.set(station, refs);
  }

  return usage;
}
