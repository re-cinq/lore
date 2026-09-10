import * as d3 from "d3";
import type { SpecRing } from "@/lib/spec-graph";
import type { GraphController } from "./spec-graph-controller-types";
import type { SectionArc, StatementArc } from "./spec-graph-ring-layout";
import { computeRing, type ExpandData } from "./spec-graph-ring-layout";
import type { SimNode } from "./spec-graph-visual";

/** Ring pinning, rendering, and the expand/collapse workflow for a Spec node's two-ring drill-down. */

export async function toggleExpand(
  c: GraphController,
  d: SimNode,
  coverageTint: (t: number) => string,
): Promise<void> {
  if (d.type !== "Spec" || !d.path) {
    return;
  }

  if (c.expanded.has(d.id)) {
    collapseSpecNode(c, d, coverageTint);

    return;
  }

  await expandSpecNode(c, d, coverageTint);
}

export function collapseSpecNode(
  c: GraphController,
  d: SimNode,
  coverageTint: (t: number) => string,
): void {
  c.expanded.delete(d.id);
  d.fx = null;
  d.fy = null;
  commitRingChange(c, coverageTint, 0.4);
}

async function expandSpecNode(
  c: GraphController,
  d: SimNode,
  coverageTint: (t: number) => string,
): Promise<void> {
  if (!d.path) {
    return;
  }
  // Pin spec to prevent ring drift on sim restart, so double-click collapse still hits.
  d.fx = d.x;
  d.fy = d.y;

  const ring = await fetchSpecRing(c.repo, d.path);

  if (!ring) {
    return;
  }
  c.expanded.set(d.id, computeRing(d.path, ring));
  commitRingChange(c, coverageTint, 0.5);
}

/** The spec's ring data, or nothing when the request fails or the spec has no sections and no statements. */
async function fetchSpecRing(
  repo: string,
  specPath: string,
): Promise<SpecRing | undefined> {
  const res = await fetch(
    `/api/repos/${repo}/spec-ring?spec=${encodeURIComponent(specPath)}`,
    { signal: AbortSignal.timeout(15_000) },
  );

  if (!res.ok) {
    return undefined;
  }
  const ring = (await res.json()) as SpecRing;
  const empty = ring.sections.length === 0 && ring.statements.length === 0;

  return empty ? undefined : ring;
}

/** Re-renders the rings and reheats the simulation so the new pinning takes effect, then persists the state. */
function commitRingChange(
  c: GraphController,
  coverageTint: (t: number) => string,
  alpha: number,
): void {
  applyRingState(c);
  renderRings(c, coverageTint);
  c.sim.alpha(alpha);
  c.sim.restart();
  c.saveState();
}

// Hide force-nodes that rings represent (statements drawn as outer-ring arcs instead).
export function applyRingState(c: GraphController): void {
  c.ringPinned = new Set<string>();

  c.expanded.forEach((exp) => {
    exp.statements.forEach((s) => {
      c.ringPinned.add(s.uid);
    });
  });
  const { nodeG } = c;

  nodeG
    .selectAll<SVGGElement, SimNode>("g")
    .style("display", (d) => (c.ringPinned.has(d.id) ? "none" : ""));
}

export function renderRings(
  c: GraphController,
  coverageTint: (t: number) => string,
): void {
  const rings = c.ringG.selectAll<SVGGElement, [string, ExpandData]>("g.ring");
  const sel = rings.data([...c.expanded.entries()], (d) => d[0]);

  sel.exit().remove();
  sel
    .enter()
    .append("g")
    .attr("class", "ring")
    .merge(sel)
    .each(function (entry) {
      const exp = entry[1];
      const g = d3.select<SVGGElement, unknown>(this);

      renderSectionArcs(g, exp, c, coverageTint);
      renderStatementArcs(g, exp, c);
    });
}

function renderSectionArcs(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  exp: ExpandData,
  c: GraphController,
  coverageTint: (t: number) => string,
): void {
  g.selectAll<SVGPathElement, SectionArc>("path.sec")
    .data(exp.sections, (s) => s.uid)
    .join("path")
    .attr("class", "sec")
    .attr("d", (s) => s.d)
    .attr("fill", (s) =>
      s.total > 0 ? coverageTint(s.tested / s.total) : "var(--chart-neutral)",
    )
    .attr("fill-opacity", 0.5)
    .attr("stroke", "var(--bg-surface)")
    .attr("stroke-width", 1)
    .style("cursor", "pointer")
    .call((sel) => wireSectionHandlers(sel, exp, c));
}

const TESTED_FILL = "var(--success)";
const UNTESTED_FILL = "var(--danger)";

function renderStatementArcs(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  exp: ExpandData,
  c: GraphController,
): void {
  g.selectAll<SVGPathElement, StatementArc>("path.st")
    .data(exp.statements, (s) => s.uid)
    .join("path")
    .attr("class", "st")
    .attr("d", (s) => s.d)
    .attr("fill", (s) => (s.tested ? TESTED_FILL : UNTESTED_FILL))
    .attr("fill-opacity", 0.78)
    .style("cursor", "pointer")
    .call((sel) => wireStatementHandlers(sel, exp, c));
}

function wireSectionHandlers(
  sel: d3.Selection<SVGPathElement, SectionArc, SVGGElement, unknown>,
  exp: ExpandData,
  c: GraphController,
): void {
  sel
    .on("click", (event: PointerEvent, section) => {
      event.stopPropagation();
      selectSection(c, exp, section);
    })
    .on("mouseenter mousemove", (event: PointerEvent, section) =>
      hoverSection(c, event, section),
    )
    .on("mouseleave", () => c.setHover(null));
}

/** Selecting a section clears `selectedIdRef` — a section is not a graph NODE, so leaving the previous node's id set would keep highlighting it behind the newly selected arc. */
function selectSection(
  c: GraphController,
  exp: ExpandData,
  section: SectionArc,
): void {
  c.selectedIdRef.current = null;
  c.setSelected({
    id: section.uid,
    type: "Section",
    label: section.heading,
    path: exp.specPath,
  });
}

function hoverSection(
  c: GraphController,
  event: PointerEvent,
  section: SectionArc,
): void {
  const [pointerX, pointerY] = d3.pointer(event, c.el);

  c.setHover({
    text: `${section.heading} — ${section.tested}/${section.total} tested`,
    x: pointerX,
    y: pointerY,
  });
}

function wireStatementHandlers(
  sel: d3.Selection<SVGPathElement, StatementArc, SVGGElement, unknown>,
  exp: ExpandData,
  c: GraphController,
): void {
  sel
    .on("click", (event: PointerEvent, s) => {
      event.stopPropagation();
      selectStatement(c, exp, s);
    })
    .on("mouseenter mousemove", (event: PointerEvent, s) =>
      hoverStatement(c, event, s),
    )
    .on("mouseleave", () => c.setHover(null));
}

/** Selecting a statement arc clears `selectedIdRef` for the same reason a section does — an arc is not a node. */
function selectStatement(
  c: GraphController,
  exp: ExpandData,
  s: StatementArc,
): void {
  c.selectedIdRef.current = null;
  c.setSelected({
    id: s.uid,
    type: "Statement",
    label: "",
    detail: s.text,
    path: exp.specPath,
  });
}

function hoverStatement(
  c: GraphController,
  event: PointerEvent,
  s: StatementArc,
): void {
  const [px, py] = d3.pointer(event, c.el);

  c.setHover({ text: s.text || "(statement)", x: px, y: py });
}
