// Which catalog entries the blueprints actually dispatch — the reverse of the catalog roster (lore.agent_definitions), so the /agents UI can show a definition's references instead of leaving "is this dead?" to grep. Service-form nodes resolve to def-<type> names with no catalog row; they fall out naturally when the caller joins this map against the definitions list.

import type { AssemblyLine } from "./loader.js";
import { resolveNodeStation } from "./node-station.js";

export interface StationUsageRef {
  // The blueprint (assembly-line definition) whose node dispatches it.
  blueprint: string;
  nodeId: string;
  // True when the name came from the node's type or its line, not the node — silently changes when a node is reused on another line.
  inherited: boolean;
}

// Every station name any blueprint node resolves to, with the nodes that resolve there. Human nodes dispatch nothing and are skipped.
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
