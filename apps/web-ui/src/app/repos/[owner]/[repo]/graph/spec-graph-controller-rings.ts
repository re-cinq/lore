import * as d3 from "d3";
import type { SpecRing } from "@/lib/spec-graph";
import type { GraphController } from "./spec-graph-controller-types";
import type { SectionArc, StatementArc } from "./spec-graph-ring-layout";
import { computeRing, type ExpandData } from "./spec-graph-ring-layout";
import type { SimNode } from "./spec-graph-visual";

/** Ring pinning, rendering, and the expand/collapse workflow for a Spec node's two-ring drill-down. */

// Hide force-nodes that rings represent (statements drawn as outer-ring arcs instead).
export function applyRingState(c: GraphController): void {
  c.ringPinned = new Set<string>();

  c.expanded.forEach((exp) => {
    exp.statements.forEach((s) => {
      c.ringPinned.add(s.uid);
    });
  });
  c.nodeG
    .selectAll<SVGGElement, SimNode>("g")
    .style("display", (d) => (c.ringPinned.has(d.id) ? "none" : ""));
}

const TESTED_FILL = "var(--success)";
const UNTESTED_FILL = "var(--danger)";

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
    .on("click", (event: PointerEvent, s) => {
      event.stopPropagation();
      c.selectedIdRef.current = null;
      c.setSelected({
        id: s.uid,
        type: "Section",
        label: s.heading,
        path: exp.specPath,
      });
    })
    .on("mouseenter mousemove", (event: PointerEvent, s) => {
      const [px, py] = d3.pointer(event, c.el);

      c.setHover({
        text: `${s.heading} — ${s.tested}/${s.total} tested`,
        x: px,
        y: py,
      });
    })
    .on("mouseleave", () => c.setHover(null));
}

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
    .on("click", (event: PointerEvent, s) => {
      event.stopPropagation();
      c.selectedIdRef.current = null;
      c.setSelected({
        id: s.uid,
        type: "Statement",
        label: "",
        detail: s.text,
        path: exp.specPath,
      });
    })
    .on("mouseenter mousemove", (event: PointerEvent, s) => {
      const [px, py] = d3.pointer(event, c.el);

      c.setHover({ text: s.text || "(statement)", x: px, y: py });
    })
    .on("mouseleave", () => c.setHover(null));
}

export function renderRings(
  c: GraphController,
  coverageTint: (t: number) => string,
): void {
  const sel = c.ringG
    .selectAll<SVGGElement, [string, ExpandData]>("g.ring")
    .data([...c.expanded.entries()], (d) => d[0]);

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

export function collapseSpecNode(
  c: GraphController,
  d: SimNode,
  coverageTint: (t: number) => string,
): void {
  c.expanded.delete(d.id);
  d.fx = null;
  d.fy = null;
  applyRingState(c);
  renderRings(c, coverageTint);
  c.sim.alpha(0.4).restart();
  c.saveState();
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
  const res = await fetch(
    `/api/repos/${c.repo}/spec-ring?spec=${encodeURIComponent(d.path)}`,
    { signal: AbortSignal.timeout(15_000) },
  );

  if (!res.ok) {
    return;
  }
  const ring = (await res.json()) as SpecRing;

  if (ring.sections.length === 0 && ring.statements.length === 0) {
    return;
  }
  c.expanded.set(d.id, computeRing(d.path, ring));
  applyRingState(c);
  renderRings(c, coverageTint);
  c.sim.alpha(0.5).restart();
  c.saveState();
}

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
