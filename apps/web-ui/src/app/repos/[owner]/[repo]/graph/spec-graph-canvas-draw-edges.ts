import * as d3 from "d3";
import { visibleSegments } from "@/lib/segment-clip";
import { idOf, type SimNode, type SimLink } from "./spec-graph-visual";
import type { CanvasColors, CanvasDrawState } from "./spec-graph-canvas-draw";

/** The edge pass of the canvas draw loop: bundled cross-cutting edges follow their spine, everything else is a straight, ring-clipped segment. */

export interface EdgeDrawDeps {
  ctx: CanvasRenderingContext2D;
  colors: CanvasColors;
  aggHidden: Set<string>;
  bundleLine: d3.Line<[number, number]>;
}

function pointOf(n: SimNode): { x: number; y: number } {
  return { x: n.x ?? 0, y: n.y ?? 0 };
}

// An edge into a ring-represented statement, or touching a collapsed leaf, never gets drawn.
function shouldSkipEdge(
  l: SimLink,
  collapsing: boolean,
  ringPinned: Set<string>,
  aggHidden: Set<string>,
): boolean {
  const sId = idOf(l.source as string | SimNode);
  const tId = idOf(l.target as string | SimNode);

  if (l.kind === "in_spec" && ringPinned.has(tId)) {
    return true;
  }

  return collapsing && (aggHidden.has(sId) || aggHidden.has(tId));
}

function strokeEdge(
  deps: EdgeDrawDeps,
  l: SimLink,
  endpoints: { s: SimNode; t: SimNode },
  state: CanvasDrawState,
): void {
  const { ctx, colors, bundleLine } = deps;
  const { s, t } = endpoints;
  const op = state.edgeOpacity(idOf(s), idOf(t));

  if (op <= 0.07) {
    return;
  }
  ctx.globalAlpha = op;
  ctx.strokeStyle = colors.edgeColor;

  const bundlePts = (l.controlIds ?? [])
    .map((id) => state.nodeById.get(id))
    .filter((n): n is SimNode => !!n)
    .map((n) => [n.x ?? 0, n.y ?? 0] as [number, number]);

  if (bundlePts.length > 2) {
    ctx.beginPath();
    bundleLine(bundlePts);
    ctx.stroke();

    return;
  }
  // Straight edge, clipped so it never crosses an open ring's interior.
  const pieces = visibleSegments(pointOf(s), pointOf(t), state.ringDiscs);

  ctx.beginPath();
  pieces.forEach((p) => {
    ctx.moveTo(p.a.x, p.a.y);
    ctx.lineTo(p.b.x, p.b.y);
  });
  ctx.stroke();
}

export function drawEdges(
  deps: EdgeDrawDeps,
  state: CanvasDrawState,
  collapsing: boolean,
): void {
  deps.ctx.lineWidth = 1.3 / state.transform.k;

  for (const l of state.links) {
    if (shouldSkipEdge(l, collapsing, state.ringPinned, deps.aggHidden)) {
      continue;
    }
    strokeEdge(
      deps,
      l,
      { s: l.source as SimNode, t: l.target as SimNode },
      state,
    );
  }
}
