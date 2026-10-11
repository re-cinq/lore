// The family a node's type belongs to, which the graph shows as a glyph and a stripe (run-viz FR4.1h). Status keeps the box colour, so type needs a channel of its own.
import { HUMAN_STATIONS } from "./human-station";

export type NodeTypeFamily = "agent" | "service" | "person" | "marker";

/** A family as the legend and a node's tooltip name it. */
export const FAMILY_LABEL: Record<NodeTypeFamily, string> = {
  agent: "Agent",
  service: "Service",
  person: "Person",
  marker: "Marker",
};

const MARKER_TYPES: ReadonlySet<string> = new Set(["retrospective"]);

/** agent: an AI pod runs it. person: it waits on someone. marker: a point in the line with no work of its own. service: every other step, run by a machine. */
export function typeFamilyOf(nodeType: string | undefined): NodeTypeFamily {
  if (nodeType === undefined || MARKER_TYPES.has(nodeType)) {
    return "marker";
  }

  if (nodeType === "agent") {
    return "agent";
  }

  return nodeType in HUMAN_STATIONS ? "person" : "service";
}
