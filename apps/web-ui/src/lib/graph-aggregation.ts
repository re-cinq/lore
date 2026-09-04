/** Level-of-detail aggregation for D3 spec-graph; collapses degree-1 leaves. */

import { nodeDegrees, type DegreeLink } from "./graph-crowding";
import type { SpecGraphNodeType } from "./spec-graph";

export interface AggNode {
  id: string;
  type: SpecGraphNodeType;
}

/** A collapsed group: how many leaves of one type hang off a single parent. */
export interface LeafBadge {
  parentId: string;
  type: SpecGraphNodeType;
  count: number;
}

export interface AggregationResult {
  hidden: Set<string>;
  badges: LeafBadge[];
}

function isCollapsibleLeaf(
  node: AggNode,
  degree: Map<string, number>,
  collapsibleTypes: Set<SpecGraphNodeType>,
): boolean {
  return collapsibleTypes.has(node.type) && (degree.get(node.id) ?? 0) === 1;
}

/** Add one leaf to its parent's badge, creating the badge on the first leaf. */
function recordBadge(
  groups: Map<string, LeafBadge>,
  parentId: string,
  type: SpecGraphNodeType,
): void {
  const key = `${parentId}::${type}`;
  const badge = groups.get(key);

  if (badge) {
    badge.count += 1;

    return;
  }
  groups.set(key, { parentId, type, count: 1 });
}

/** Collapse degree-1 nodes onto single neighbour; return ids to hide and badge counts. */
export function aggregateLeaves(
  nodes: AggNode[],
  links: DegreeLink[],
  collapsibleTypes: Set<SpecGraphNodeType>,
): AggregationResult {
  const degree = nodeDegrees(links);
  // Degree-1 node's single opposite endpoint is its parent.
  const parentOf = new Map<string, string>();

  for (const { source, target } of links) {
    parentOf.set(source, target);
    parentOf.set(target, source);
  }

  const hidden = new Set<string>();
  const groups = new Map<string, LeafBadge>();

  for (const node of nodes) {
    if (!isCollapsibleLeaf(node, degree, collapsibleTypes)) {
      continue;
    }
    // Degree 1 guarantees parentOf has this node's id (populated from the same links).
    const parentId = parentOf.get(node.id)!;

    hidden.add(node.id);
    recordBadge(groups, parentId, node.type);
  }

  return { hidden, badges: [...groups.values()] };
}

/** LOD gate: collapse leaves while zoomed further out than `threshold`. */
export function shouldAggregate(zoomScale: number, threshold: number): boolean {
  return zoomScale < threshold;
}
