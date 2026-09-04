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
} from "./spec-graph-visual";
import { visibleLeaf } from "./spec-graph-canvas-draw";
import type { ExpandData } from "./spec-graph-ring-layout";
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

function leafHitNodes(c: GraphController, collapsing: boolean) {
  return c.nodes
    .filter((n) => visibleLeaf(n, c.aggHidden, collapsing))
    .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, r: radiusOf(n.type) }));
}

// SVG covers canvas: background click inverts pointer, hit-tests leaf dots.
export function wireBackgroundClick(
  c: GraphController,
  isAggregating: () => boolean,
): void {
  c.svg.on("click", (event: PointerEvent) => {
    const [px, py] = d3.pointer(event, c.el);
    const world = invertPoint(c.transform as ZoomTransform, { x: px, y: py });
    const hitId = findNodeAtPoint(
      world,
      leafHitNodes(c, isAggregating()),
      HIT_SLOP,
    );
    const hit = hitId ? c.nodeById.get(hitId) : undefined;

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
  });
}

// Pin statements on outer ring, fan related nodes radially outward: short spokes never chords.
function placeStatementSpokes(
  c: GraphController,
  exp: ExpandData,
  cx: number,
  cy: number,
): void {
  exp.statements.forEach((s) => {
    const n = c.nodeById.get(s.uid);

    if (n) {
      n.x = cx + exp.outerMid * Math.sin(s.mid);
      n.y = cy - exp.outerMid * Math.cos(s.mid);
      n.vx = 0;
      n.vy = 0;
    }
    let k = 0;

    c.adj.get(s.uid)?.forEach((nb) => {
      if (c.ringPinned.has(nb) || c.expanded.has(nb)) {
        return;
      }
      const leaf = c.nodeById.get(nb);

      // Only test/code chunks get spoked onto ring; ADRs are anchors (spacing force, never spoked).
      if (!leaf || !isSpokeableLeafType(leaf)) {
        return;
      }

      // Only hard-place leaves with single owner (clean radial spokes); shared chunks float.
      if (!hasSingleOwner(nb, c.adj)) {
        return;
      }
      const r = exp.outerR1 + 32 + k * 34;

      leaf.x = cx + r * Math.sin(s.mid);
      leaf.y = cy - r * Math.cos(s.mid);
      leaf.vx = 0;
      leaf.vy = 0;
      k += 1;
    });
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
  c.nodeG
    .selectAll<SVGGElement, { x?: number; y?: number }>("g")
    .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  c.ringG
    .selectAll<SVGGElement, [string, ExpandData]>("g.ring")
    .attr("transform", (entry) => {
      const spec = c.nodeById.get(entry[0]);

      return `translate(${spec?.x ?? 0},${spec?.y ?? 0})`;
    });
  c.drawer.draw(drawState(c));
}
