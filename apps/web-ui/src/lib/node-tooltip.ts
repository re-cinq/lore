// What a node's tooltip says on the run graph (run-viz FR4.1h): its name, its kind, and what its station does in a sentence or two. A marker has no station, so its end of the line says what it means.
import type { AssemblyLineDefinition } from "./assembly-line-definition";
import {
  FAMILY_LABEL,
  typeFamilyOf,
  type NodeTypeFamily,
} from "./node-type-family";

export interface NodeTooltip {
  title: string;
  kind: string;
  family: NodeTypeFamily;
  description: string;
}

const NO_DESCRIPTION = "No description yet.";

/** Null for a node the line does not have. */
export function nodeTooltipOf(
  nodeId: string,
  definition: AssemblyLineDefinition,
): NodeTooltip | null {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return null;
  }
  const family = typeFamilyOf(node.type);

  return {
    title: nodeTitle(node.id),
    kind: FAMILY_LABEL[family],
    family,
    description:
      family === "marker"
        ? markerSentence(nodeId, definition)
        : (node.description ?? NO_DESCRIPTION),
  };
}

/** A node's id as its box and its tooltip title it: the first letter up. */
export function nodeTitle(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function markerSentence(
  nodeId: string,
  { entry, exit, fail }: AssemblyLineDefinition,
): string {
  if (nodeId === fail) {
    return "The run ends here, as failed.";
  }

  if (nodeId === exit) {
    return "The run ends here.";
  }

  return nodeId === entry
    ? "Where the run starts."
    : "A waypoint the line passes through; nothing runs here.";
}
