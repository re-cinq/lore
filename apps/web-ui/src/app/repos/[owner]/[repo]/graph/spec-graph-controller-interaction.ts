import * as d3 from "d3";
import {
  invertPoint,
  findNodeAtPoint,
  type ZoomTransform,
} from "@/lib/graph-viewport";
import type { GraphController } from "./spec-graph-controller-types";
import { drawState } from "./spec-graph-controller-types";
import {
  radiusOf,
  isSpokeableLeafType,
  hasSingleOwner,
  HIT_SLOP,
  type SimNode,
} from "./spec-graph-visual";
import { visibleLeaf } from "./spec-graph-canvas-draw";
import type { ExpandData, StatementArc } from "./spec-graph-ring-layout";
import {
  highlight,
  clearHighlight,
  centerOn,
} from "./spec-graph-controller-nodes";

/** Zoom/pan, background-click hit-testing, and the per-tick frame render (ring-spoke placement + SVG/canvas repaint). */

export function createZoom(
  c: GraphController,
): d3.ZoomBehavior<SVGSVGElement, unknown> {
  return d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.05, 4])
    .on("zoom", (event) => {
      c.transform = event.transform;
      c.container.attr("transform", c.transform.toString());
      c.drawer.draw(drawState(c));
    });
}

function leafHitNodes(c: GraphController, lod: { collapsing: boolean }) {
  const leaves = c.nodes.filter((n) =>
    visibleLeaf(n, { aggHidden: c.aggHidden, collapsing: lod.collapsing }),
  );

  return leaves.map((n) => ({
    id: n.id,
    x: n.x ?? 0,
    y: n.y ?? 0,
    r: radiusOf(n.type),
  }));
}

/** The leaf dot under the pointer, if any: the click lands in screen space, the dots live in world space. */
function leafHitAt(
  c: GraphController,
  event: PointerEvent,
  lod: { collapsing: boolean },
): SimNode | undefined {
  const [px, py] = d3.pointer(event, c.el);
  const world = invertPoint(c.transform as ZoomTransform, { x: px, y: py });
  const hitId = findNodeAtPoint(world, leafHitNodes(c, lod), HIT_SLOP);

  return hitId ? c.nodeById.get(hitId) : undefined;
}

/** A hit selects, highlights and centres the leaf; a miss clears the selection. */
function selectHit(c: GraphController, hit: SimNode | undefined): void {
  if (!hit) {
    c.selectedIdRef.current = null;
    c.setSelected(null);
    clearHighlight(c);

    return;
  }
  c.selectedIdRef.current = hit.id;
  c.setSelected(hit);
  highlight(c, hit.id);
  centerOn(c, hit);
}

// SVG covers canvas: background click inverts pointer, hit-tests leaf dots.
export function wireBackgroundClick(
  c: GraphController,
  isAggregating: () => boolean,
): void {
  c.svg.on("click", (event: PointerEvent) => {
    selectHit(c, leafHitAt(c, event, { collapsing: isAggregating() }));
  });
}

/** Hard-places a node on the ring at a given angle, and stops it dead. Zeroing velocity matters as much as the position: a node the simulation is still carrying would drift straight back off the spoke. */
function pinAt(
  node: SimNode | undefined,
  {
    cx,
    cy,
    radius,
    mid,
  }: { cx: number; cy: number; radius: number; mid: number },
): void {
  if (!node) {
    return;
  }

  node.x = cx + radius * Math.sin(mid);
  node.y = cy - radius * Math.cos(mid);
  node.vx = 0;
  node.vy = 0;
}

/** The neighbour to spoke, or nothing. Three exclusions, each for its own reason: an already-pinned or expanded node has its own place; an ADR is an anchor the spacing force owns and is never spoked; and a chunk owned by several statements would be pulled toward all of them, so it floats rather than picking one. */
function spokeableLeaf(
  c: GraphController,
  neighbourId: string,
): SimNode | undefined {
  if (c.ringPinned.has(neighbourId) || c.expanded.has(neighbourId)) {
    return undefined;
  }
  const leaf = c.nodeById.get(neighbourId);

  if (
    !leaf ||
    !isSpokeableLeafType(leaf) ||
    !hasSingleOwner(neighbourId, c.adj)
  ) {
    return undefined;
  }

  return leaf;
}

/** One statement's spokeable neighbours, in adjacency order — the order decides how far out each one lands. */
function spokeableNeighbours(
  c: GraphController,
  statementUid: string,
): SimNode[] {
  const leaves: SimNode[] = [];
  const neighbours = c.adj.get(statementUid);

  neighbours?.forEach((neighbourId) => {
    const leaf = spokeableLeaf(c, neighbourId);

    if (leaf) {
      leaves.push(leaf);
    }
  });

  return leaves;
}

/** Fans one statement's neighbours outward along its own angle, each a further 34px step off the ring. */
function placeStatementNeighbours(
  c: GraphController,
  exp: ExpandData,
  statement: StatementArc,
  { cx, cy }: { cx: number; cy: number },
): void {
  spokeableNeighbours(c, statement.uid).forEach((leaf, placed) => {
    pinAt(leaf, {
      cx,
      cy,
      radius: exp.outerR1 + 32 + placed * 34,
      mid: statement.mid,
    });
  });
}

// Pin statements on outer ring, fan related nodes radially outward: short spokes never chords.
function placeStatementSpokes(
  c: GraphController,
  exp: ExpandData,
  cx: number,
  cy: number,
): void {
  exp.statements.forEach((statement) => {
    pinAt(c.nodeById.get(statement.uid), {
      cx,
      cy,
      radius: exp.outerMid,
      mid: statement.mid,
    });
    placeStatementNeighbours(c, exp, statement, { cx, cy });
  });
}

// One frame: ring-spoke placement, SVG transforms, canvas draw (driven by sim tick or manual drag).
export function renderFrame(c: GraphController): void {
  c.expanded.forEach((exp, specId) => {
    const spec = c.nodeById.get(specId);

    if (!spec) {
      return;
    }
    placeStatementSpokes(c, exp, spec.x ?? 0, spec.y ?? 0);
  });
  c.ringDiscs = [];

  for (const [specId, exp] of c.expanded) {
    const spec = c.nodeById.get(specId);

    if (spec) {
      c.ringDiscs.push({ x: spec.x ?? 0, y: spec.y ?? 0, r: exp.outerR1 });
    }
  }
  applyGroupTransforms(c);
  c.drawer.draw(drawState(c));
}

/** Move the node groups and the ring groups to their current simulation positions. */
function applyGroupTransforms(c: GraphController): void {
  const { nodeG, ringG } = c;

  nodeG
    .selectAll<SVGGElement, { x?: number; y?: number }>("g")
    .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  ringG
    .selectAll<SVGGElement, [string, ExpandData]>("g.ring")
    .attr("transform", (entry) => {
      const spec = c.nodeById.get(entry[0]);

      return `translate(${spec?.x ?? 0},${spec?.y ?? 0})`;
    });
}
