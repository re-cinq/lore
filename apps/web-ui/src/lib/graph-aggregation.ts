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
    if (!collapsibleTypes.has(node.type)) {
      continue;
    }

    if ((degree.get(node.id) ?? 0) !== 1) {
      continue;
    }
    const parentId = parentOf.get(node.id);

    if (parentId === undefined) {
      continue;
    }
    hidden.add(node.id);
    const key = `${parentId}::${node.type}`;
    const badge = groups.get(key);

    if (badge) {
      badge.count += 1;
      continue;
    }
    groups.set(key, { parentId, type: node.type, count: 1 });
  }

  return { hidden, badges: [...groups.values()] };
}

/** LOD gate: collapse leaves while zoomed further out than `threshold`. */
export function shouldAggregate(zoomScale: number, threshold: number): boolean {
  return zoomScale < threshold;
}
