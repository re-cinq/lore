/**
 * Pure level-of-detail aggregation for the D3 spec-graph.
 *
 * High-cardinality single-owner leaves (a TestChunk or File wired to exactly one
 * Statement/AcceptanceCriterion) flood the view at every zoom level. Zoomed out,
 * they carry no readable detail — so we collapse each into a per-parent count
 * badge ("3 tests") and hide the underlying node. Shared leaves (degree > 1) are
 * structural and stay visible. Value-in/value-out, no side effects; the render
 * shell decides when to apply it via `shouldAggregate`.
 */

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

/**
 * Collapses every degree-1 node whose type is in `collapsibleTypes` onto its
 * single neighbour, grouped per (parent, type). Returns the ids to hide and the
 * badge counts to draw in their place.
 */
export function aggregateLeaves(
  nodes: AggNode[],
  links: DegreeLink[],
  collapsibleTypes: Set<SpecGraphNodeType>,
): AggregationResult {
  const degree = nodeDegrees(links);
  // A degree-1 node appears in exactly one link, so its single opposite endpoint
  // is its parent. (Hubs get overwritten here, but we never read theirs.)
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
    } else {
      groups.set(key, { parentId, type: node.type, count: 1 });
    }
  }

  return { hidden, badges: [...groups.values()] };
}

/** LOD gate: collapse leaves while zoomed further out than `threshold`. */
export function shouldAggregate(zoomScale: number, threshold: number): boolean {
  return zoomScale < threshold;
}
