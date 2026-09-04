import * as d3 from "d3";
import type { SpecGraphNode } from "@/lib/spec-graph";
import { shouldAggregate } from "@/lib/graph-aggregation";
import type { Disc } from "@/lib/ring-exclusion";
import {
  isLeafCanvas,
  LOD_THRESHOLD,
  BUNDLE_BETA,
  type SimNode,
  type SimLink,
} from "./spec-graph-visual";
import { drawEdges } from "./spec-graph-canvas-draw-edges";
import {
  drawLeafNodes,
  drawAggregationBadges,
} from "./spec-graph-canvas-draw-leaves";

/** The canvas draw loop: edges (straight or bundled, ring-clipped), leaf-node dots, and the zoomed-out aggregation badges. Called once per tick/zoom/resize with a fresh snapshot of the mutable graph state. */

export interface CanvasColors {
  surfaceColor: string;
  edgeColor: string;
  badgeTextColor: string;
  canvasColorOf: (type: SpecGraphNode["type"]) => string;
}

export interface AggBadge {
  parentId: string;
  type: SpecGraphNode["type"];
  count: number;
}

export interface CanvasDrawState {
  transform: d3.ZoomTransform;
  nodes: SimNode[];
  links: SimLink[];
  ringDiscs: Disc[];
  ringPinned: Set<string>;
  nodeById: Map<string, SimNode>;
  nodeOpacity: (id: string) => number;
  edgeOpacity: (sourceId: string, targetId: string) => number;
}

export interface CanvasDrawerParams {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  dpr: number;
  colors: CanvasColors;
  aggHidden: Set<string>;
  aggBadges: AggBadge[];
}

// Shared with hit-testing: a leaf drawn on canvas is also the leaf a click can land on.
export function isAggregating(zoomK: number): boolean {
  return shouldAggregate(zoomK, LOD_THRESHOLD);
}

export function visibleLeaf(
  n: SimNode,
  aggHidden: Set<string>,
  collapsing: boolean,
): boolean {
  return isLeafCanvas(n.type) && !(collapsing && aggHidden.has(n.id));
}

export function createCanvasDrawer(params: CanvasDrawerParams) {
  const { ctx, canvas, dpr, colors, aggHidden, aggBadges } = params;
  const bundleLine = d3
    .line<[number, number]>()
    .curve(d3.curveBundle.beta(BUNDLE_BETA))
    .context(ctx);

  function draw(state: CanvasDrawState): void {
    const collapsing = isAggregating(state.transform.k);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // World-space pass: edges then leaf dots, under the zoom transform.
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(state.transform.x, state.transform.y);
    ctx.scale(state.transform.k, state.transform.k);
    drawEdges({ ctx, colors, aggHidden, bundleLine }, state, collapsing);
    drawLeafNodes({ ctx, colors, aggHidden }, state, collapsing);
    ctx.restore();

    if (collapsing) {
      drawAggregationBadges({ ctx, dpr, colors, aggBadges }, state);
    }
  }

  return { draw };
}
