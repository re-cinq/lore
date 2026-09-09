// Which Station a node actually runs on — previously implicit in the Floor's dispatch and visible nowhere else, which cost an evening: on the merged planning line every agent node inherited the LINE's Station, so `analyse-specs` and `write` both ran the planning recipe and reported success wrongly. `inherited` surfaces the case that silently breaks when a node is reused on a line whose task type differs.

import type { AssemblyLine } from "./loader.js";
import { isHumanStation } from "./human-station.js";

// The builtin Station for a node type; underscores aren't valid in an RFC-1123 resource name, so `comment-triage` stays `def-comment-triage`.
export const builtinStationName = (nodeType: string): string =>
  `def-${nodeType.replaceAll("_", "-")}`;

export interface NodeStation {
  // The Station this node dispatches to, or null when nothing dispatches.
  station: string | null;
  // True when the name came from the node's type or its LINE, not from the node.
  inherited: boolean;
}

// Resolve a node's Station, given the task type of the line it runs on.
export function resolveNodeStation(
  node: AssemblyLine["nodes"][number],
  lineTaskType: string,
): NodeStation {
  // A human station has no Station at all: its worker is a person, so there is nothing to dispatch.
  if (isHumanStation(node.type)) {
    return { station: null, inherited: false };
  }

  if (node.station_ref) {
    return { station: node.station_ref, inherited: false };
  }

  return node.type === "agent"
    ? { station: lineTaskType, inherited: true }
    : { station: builtinStationName(node.type), inherited: true };
}
