import { applyPoint, type ZoomTransform } from "@/lib/graph-viewport";
import { isLeafCanvas, radiusOf, type SimNode } from "./spec-graph-visual";
import type {
  AggBadge,
  CanvasColors,
  CanvasDrawState,
} from "./spec-graph-canvas-draw";

/** The leaf-node dot pass and the zoomed-out per-parent aggregation-count badges. */

export interface LeafDrawDeps {
  ctx: CanvasRenderingContext2D;
  colors: CanvasColors;
  aggHidden: Set<string>;
}

function shouldSkipLeaf(
  deps: LeafDrawDeps,
  n: SimNode,
  collapsing: boolean,
  state: CanvasDrawState,
): boolean {
  if (!isLeafCanvas(n.type) || (collapsing && deps.aggHidden.has(n.id))) {
    return true;
  }

  return state.nodeOpacity(n.id) <= 0;
}

function drawLeafNode(
  deps: LeafDrawDeps,
  n: SimNode,
  state: CanvasDrawState,
): void {
  const { ctx, colors } = deps;

  ctx.globalAlpha = state.nodeOpacity(n.id);
  ctx.fillStyle = colors.canvasColorOf(n.type);
  ctx.beginPath();
  ctx.arc(n.x ?? 0, n.y ?? 0, radiusOf(n.type), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.surfaceColor;
  ctx.stroke();
}

export function drawLeafNodes(
  deps: LeafDrawDeps,
  state: CanvasDrawState,
  collapsing: boolean,
): void {
  deps.ctx.lineWidth = 1.5 / state.transform.k;

  for (const n of state.nodes) {
    if (!shouldSkipLeaf(deps, n, collapsing, state)) {
      drawLeafNode(deps, n, state);
    }
  }
}

export interface BadgeDrawDeps {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  colors: CanvasColors;
  aggBadges: AggBadge[];
}

function drawBadge(
  deps: BadgeDrawDeps,
  badge: AggBadge,
  state: CanvasDrawState,
): void {
  const { ctx, colors } = deps;
  const parent = state.nodeById.get(badge.parentId);

  if (!parent) {
    return;
  }
  const screen = applyPoint(state.transform as ZoomTransform, {
    x: parent.x ?? 0,
    y: parent.y ?? 0,
  });
  const px = screen.x + radiusOf(parent.type) + 8;
  const py = screen.y - radiusOf(parent.type);

  ctx.fillStyle = colors.canvasColorOf(badge.type);
  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.badgeTextColor;
  ctx.fillText(String(badge.count), px, py + 0.5);
}

// Screen-space pass: count badges over collapsed parents (CSS pixels, zoom-readable).
export function drawAggregationBadges(
  deps: BadgeDrawDeps,
  state: CanvasDrawState,
): void {
  const { ctx, dpr } = deps;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.font = "600 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  deps.aggBadges.forEach((badge) => drawBadge(deps, badge, state));
  ctx.restore();
}
