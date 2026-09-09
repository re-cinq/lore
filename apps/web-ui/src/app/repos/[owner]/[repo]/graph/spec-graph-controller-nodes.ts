import * as d3 from "d3";
import { settleTicks, countCrossings } from "@/lib/graph-layout";
import type { GraphController } from "./spec-graph-controller-types";
import type { PreparedGraphLayout } from "./spec-graph-data-prep";
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

/** The neighbour set for `id`, created and stored on first ask. */
function neighborsOf(adj: Map<string, Set<string>>, id: string): Set<string> {
  const existing = adj.get(id);

  if (existing) {
    return existing;
  }
  const created = new Set<string>();

  adj.set(id, created);

  return created;
}

export function buildAdj(c: GraphController): void {
  const adj = new Map<string, Set<string>>();

  for (const l of c.links) {
    const s = idOf(l.source as string | SimNode);
    const t = idOf(l.target as string | SimNode);

    neighborsOf(adj, s).add(t);
    neighborsOf(adj, t).add(s);
  }
  c.adj = adj;
}

export function applyVisualState(c: GraphController): void {
  const { nodeG } = c;

  nodeG
    .selectAll<SVGGElement, SimNode>("g")
    .attr("opacity", (d) => c.focus.nodeOpacity(d.id));
  nodeG
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
  const { zoomIdentity } = d3;
  const t = zoomIdentity
    .translate(c.width / 2 - (d.x ?? 0) * k, c.height / 2 - (d.y ?? 0) * k)
    .scale(k);
  const { svg, zoom } = c;
  const glide = svg.transition().duration(500);

  glide.call(zoom.transform, t);
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
  layout: Pick<PreparedGraphLayout, "restoredFromStorage">,
): void {
  if (layout.restoredFromStorage) {
    return;
  }
  const warm = settleTicks(c.nodes.length);

  for (let i = 0; i < warm; i += 1) {
    c.sim.tick();
  }
}

type NodeDragEvent = d3.D3DragEvent<SVGGElement, SimNode, SimNode>;

/** Drag start: warms the simulation so neighbours react, then pins the node under the pointer. */
function beginDrag(c: GraphController, event: NodeDragEvent, d: SimNode): void {
  const { sim } = c;

  if (!event.active) {
    sim.alphaTarget(0.1).restart();
  }
  d.fx = d.x;
  d.fy = d.y;
}

/** Drag end: cools the simulation, and leaves fx/fy pinned at the drop point — a dragged node stays put. */
function endDrag(c: GraphController, event: NodeDragEvent): void {
  const { sim } = c;

  if (!event.active) {
    sim.alphaTarget(0);
  }
  c.saveState();
}

/** Elastic drag: link springs tug neighbors while seed forces pull back toward home. */
function wireDrag(
  selection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
  c: GraphController,
): void {
  selection.call(
    d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => beginDrag(c, event, d))
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event) => endDrag(c, event)),
  );
}

type NodeSelection = d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;

/** Selecting a node: it becomes the focus root, and the view glides to it. */
function selectNode(c: GraphController, d: SimNode): void {
  c.selectedIdRef.current = d.id;
  c.setSelected(d);
  highlight(c, d.id);
  centerOn(c, d);
}

/** The hover tooltip's text and pointer position — a node with nothing to say shows none rather than an empty one. */
function showHover(c: GraphController, event: PointerEvent, d: SimNode): void {
  const text = (d.detail?.trim() || d.label || d.path || "").trim();

  if (!text) {
    c.setHover(null);

    return;
  }
  const [pointerX, pointerY] = d3.pointer(event, c.el);

  c.setHover({ text, x: pointerX, y: pointerY });
}

/** Click selects and centres, double-click expands, hover explains. Every handler stops propagation because the canvas behind the node has its own click that clears the selection. */
function wireNodeHandlers(
  g: NodeSelection,
  c: GraphController,
  coverageTint: (t: number) => string,
): void {
  g.on("click", (event: PointerEvent, d) => {
    event.stopPropagation();
    selectNode(c, d);
  })
    .on("dblclick", (event: PointerEvent, d) => {
      event.stopPropagation();
      void toggleExpand(c, d, coverageTint);
    })
    .on("mouseenter mousemove", (event: PointerEvent, d) =>
      showHover(c, event, d),
    )
    .on("mouseleave", () => c.setHover(null));
}

/** The circle every node gets, and the label only some do. Labels are `pointer-events: none` so the text never intercepts a click meant for the node it names. */
function appendNodeShapes(g: NodeSelection): void {
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
}

function enterNodeGroups(
  enter: d3.Selection<d3.EnterElement, SimNode, SVGGElement, unknown>,
  c: GraphController,
  coverageTint: (t: number) => string,
): d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> {
  const g = enter.append("g").style("cursor", "pointer");

  wireNodeHandlers(g, c, coverageTint);
  wireDrag(g, c);
  appendNodeShapes(g);

  return g;
}

/** The data join. Canvas leaves are left out on purpose — they are drawn on the canvas layer, not as SVG groups. */
function joinNodeGroups(
  c: GraphController,
  coverageTint: (t: number) => string,
): void {
  const groups = c.nodeG.selectAll<SVGGElement, SimNode>("g");

  groups
    .data(
      c.nodes.filter((n) => !isLeafCanvas(n.type)),
      (d) => d.id,
    )
    .join((enter) => enterNodeGroups(enter, c, coverageTint));
}

/** Everything the join invalidates: adjacency, the id index, ring state, and the search binding. */
function rebuildIndexes(
  c: GraphController,
  bindFilter: (fn: (q: string) => void) => void,
): void {
  buildAdj(c);
  c.nodeById = new Map(c.nodes.map((n) => [n.id, n]));
  applyRingState(c);
  bindFilter((q) => applyFilter(c, q));
}

export function update(
  c: GraphController,
  layout: Pick<PreparedGraphLayout, "restoredFromStorage">,
  bindFilter: (fn: (q: string) => void) => void,
  coverageTint: (t: number) => string,
): void {
  const { sim } = c;

  sim.nodes(c.nodes);
  c.linkForce.links(c.links);
  joinNodeGroups(c, coverageTint);
  rebuildIndexes(c, bindFilter);
  prewarmIfFresh(c, layout);
  sim.alpha(0).restart();

  highlightOrDraw(c);
  measureCrossings(c);
}
