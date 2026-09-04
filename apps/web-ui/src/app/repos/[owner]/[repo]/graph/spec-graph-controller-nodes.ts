import * as d3 from "d3";
import { settleTicks, countCrossings } from "@/lib/graph-layout";
import type { GraphController } from "./spec-graph-controller-types";
import { drawState } from "./spec-graph-controller-types";
import {
  idOf,
  isLeafCanvas,
  radiusOf,
  nodeColor,
  bfsLevels,
  LABELED_TYPES,
  type SimNode,
} from "./spec-graph-visual";
import { applyRingState, toggleExpand } from "./spec-graph-controller-rings";

/** The SVG node-group lifecycle: the data join (drag/click/hover wiring), focus/search visual state, and the settle + edge-crossing measurement that follow a rebuild. */

export function buildAdj(c: GraphController): void {
  c.adj = new Map();

  for (const l of c.links) {
    const s = idOf(l.source as string | SimNode);
    const t = idOf(l.target as string | SimNode);

    (c.adj.get(s) ?? c.adj.set(s, new Set()).get(s)!).add(t);
    (c.adj.get(t) ?? c.adj.set(t, new Set()).get(t)!).add(s);
  }
}

export function applyVisualState(c: GraphController): void {
  c.nodeG
    .selectAll<SVGGElement, SimNode>("g")
    .attr("opacity", (d) => c.focus.nodeOpacity(d.id));
  c.nodeG
    .selectAll<SVGCircleElement, SimNode>("circle")
    .attr("stroke-width", (d) => (d.id === c.selectedIdRef.current ? 4 : 2));
  c.drawer.draw(drawState(c));
}

export function highlight(c: GraphController, startId: string): void {
  c.focus.setFocusLevels(bfsLevels(c.adj, startId, 3));
  applyVisualState(c);
}

export function clearHighlight(c: GraphController): void {
  c.focus.setFocusLevels(null);
  applyVisualState(c);
}

export function applyFilter(c: GraphController, query: string): void {
  c.focus.setSearchTerm(query);
  applyVisualState(c);
}

export function centerOn(c: GraphController, d: SimNode): void {
  const k = 1.4;
  const t = d3.zoomIdentity
    .translate(c.width / 2 - (d.x ?? 0) * k, c.height / 2 - (d.y ?? 0) * k)
    .scale(k);

  c.svg.transition().duration(500).call(c.zoom.transform, t);
}

function highlightOrDraw(c: GraphController): void {
  const selectedId = c.selectedIdRef.current;

  if (selectedId && c.adj.has(selectedId)) {
    highlight(c, selectedId);

    return;
  }
  c.drawer.draw(drawState(c));
}

// Layout-quality probe: count edge crossings at settled positions (O(E²), skip dense graphs).
const CROSSINGS_EDGE_CAP = 2500;

export function measureCrossings(c: GraphController): void {
  if (c.links.length > CROSSINGS_EDGE_CAP) {
    c.setCrossings(-1);

    return;
  }
  const pos = new Map(c.nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const edges = c.links.map((l) => ({
    source: idOf(l.source as string | SimNode),
    target: idOf(l.target as string | SimNode),
  }));

  c.setCrossings(countCrossings(edges, pos));
}

// Pre-warm fresh layouts headless, start at alpha 0 for settled positions on first paint.
function prewarmIfFresh(
  c: GraphController,
  restoredFromStorage: boolean,
): void {
  if (restoredFromStorage) {
    return;
  }
  const warm = settleTicks(c.nodes.length);

  for (let i = 0; i < warm; i += 1) {
    c.sim.tick();
  }
}

function wireDrag(
  selection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
  c: GraphController,
): void {
  selection.call(
    d3
      .drag<SVGGElement, SimNode>()
      // Elastic drag: link springs tug neighbors while seed forces pull back toward home.
      .on("start", (event, d) => {
        if (!event.active) {
          c.sim.alphaTarget(0.1).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active) {
          c.sim.alphaTarget(0);
        }
        // Leave fx/fy pinned at the drop point — a dragged node stays put.
        c.saveState();
      }),
  );
}

function enterNodeGroups(
  enter: d3.Selection<d3.EnterElement, SimNode, SVGGElement, unknown>,
  c: GraphController,
  coverageTint: (t: number) => string,
): d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> {
  const g = enter
    .append("g")
    .style("cursor", "pointer")
    .on("click", (event: PointerEvent, d) => {
      event.stopPropagation();
      c.selectedIdRef.current = d.id;
      c.setSelected(d);
      highlight(c, d.id);
      centerOn(c, d);
    })
    .on("dblclick", (event: PointerEvent, d) => {
      event.stopPropagation();
      void toggleExpand(c, d, coverageTint);
    })
    .on("mouseenter mousemove", (event: PointerEvent, d) => {
      const text = (d.detail?.trim() || d.label || d.path || "").trim();

      if (!text) {
        c.setHover(null);

        return;
      }
      const [px, py] = d3.pointer(event, c.el);

      c.setHover({ text, x: px, y: py });
    })
    .on("mouseleave", () => c.setHover(null));

  wireDrag(g, c);

  g.append("circle")
    .attr("r", (d) => radiusOf(d.type))
    .attr("fill", (d) => nodeColor(d))
    .style("stroke", "var(--bg-surface)")
    .attr("stroke-width", 2);
  g.filter((d) => d.label !== "" && LABELED_TYPES.has(d.type))
    .append("text")
    .text((d) => d.label)
    .attr("x", (d) => radiusOf(d.type) + 4)
    .attr("y", 4)
    .attr("font-size", "12px")
    .attr("font-weight", (d) => (d.type === "Spec" ? 600 : 400))
    .attr("fill", "currentColor")
    .style("pointer-events", "none");

  return g;
}

export function update(
  c: GraphController,
  restoredFromStorage: boolean,
  bindFilter: (fn: (q: string) => void) => void,
  coverageTint: (t: number) => string,
): void {
  c.sim.nodes(c.nodes);
  c.linkForce.links(c.links);

  c.nodeG
    .selectAll<SVGGElement, SimNode>("g")
    .data(
      c.nodes.filter((n) => !isLeafCanvas(n.type)),
      (d) => d.id,
    )
    .join((enter) => enterNodeGroups(enter, c, coverageTint));

  buildAdj(c);
  c.nodeById = new Map(c.nodes.map((n) => [n.id, n]));
  applyRingState(c);
  bindFilter((q) => applyFilter(c, q));

  prewarmIfFresh(c, restoredFromStorage);
  c.sim.alpha(0).restart();

  highlightOrDraw(c);
  measureCrossings(c);
}
