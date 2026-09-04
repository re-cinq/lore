"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { SpecGraph, SpecGraphNode } from "@/lib/spec-graph";
import {
  serializeGraphState,
  captureGraphState,
} from "@/lib/graph-persistence";
import { cssToken, resolveColor } from "@/lib/theme-token-resolve";
import { COLORS, colorOf } from "./spec-graph-visual";
import { prepareGraphLayout } from "./spec-graph-data-prep";
import { createGraphSimulation } from "./spec-graph-simulation";
import { createFocusState } from "./spec-graph-focus-state";
import { createCanvasDrawer, isAggregating } from "./spec-graph-canvas-draw";
import { drawState, type GraphController } from "./spec-graph-controller-types";
import { update, measureCrossings } from "./spec-graph-controller-nodes";
import { toggleExpand } from "./spec-graph-controller-rings";
import {
  createZoom,
  wireBackgroundClick,
  renderFrame,
} from "./spec-graph-controller-interaction";
import {
  resolveRenderTargets,
  restoreExpandedRings,
  elementSize,
  devicePixelRatioSafe,
} from "./spec-graph-seed-layout";
import {
  CrossingsLabel,
  HoverTooltip,
  SelectedNodeCard,
} from "./SpecGraphOverlays";

export { computeRing } from "./spec-graph-ring-layout";
export { nodeLinks } from "./spec-graph-node-links";

function resolveColors(el: SVGSVGElement) {
  // Canvas needs literal colors (not var() strings); tokens resolved per render, SVG keeps var() refs.
  const tokenStyles = getComputedStyle(el);
  const lookup = (name: string) => tokenStyles.getPropertyValue(name);

  return {
    surfaceColor: cssToken(lookup, "--bg-surface", "#ffffff"),
    edgeColor: cssToken(lookup, "--chart-neutral", "#94a3b8"),
    badgeTextColor: cssToken(lookup, "--text-on-accent", "#ffffff"),
    canvasColorOf: (type: SpecGraphNode["type"]) =>
      resolveColor(lookup, colorOf(type)),
    coverageTint: d3.interpolateRgb(
      cssToken(lookup, "--danger", "#dc2626"),
      cssToken(lookup, "--success", "#16a34a"),
    ),
  };
}

// eslint-disable-next-line max-lines-per-function -- imperative d3 canvas renderer: one effect owning the simulation, the draw loop and the hit testing, which is also why vitest.config excludes it from coverage. Splitting it needs its own piece of work, not a sweep.
export default function SpecGraphD3({
  graph,
  repo,
  searchQuery = "",
  resetSignal = 0,
}: {
  graph: SpecGraph;
  repo: string;
  searchQuery?: string;
  resetSignal?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<SpecGraphNode | null>(null);
  const [hover, setHover] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  // Edge-crossing count (layout-quality metric): -1 = too many, null = not measured.
  const [crossings, setCrossings] = useState<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  // Defined in main effect so search-only effect can re-run filter without rebuild.
  const filterRef = useRef<(q: string) => void>(() => {});

  // eslint-disable-next-line max-lines-per-function -- the renderer itself: simulation, draw loop and hit testing over one shared canvas context. See the note on the component.
  useEffect(() => {
    const targets = resolveRenderTargets(ref.current, canvasRef.current);

    if (!targets) {
      return;
    }
    const { el, canvas, ctx } = targets;
    let { width, height } = elementSize(el);
    const svg = d3.select(el);

    svg.selectAll("*").remove();

    if (graph.nodes.length === 0) {
      return;
    }

    // Canvas uses CSS pixels; backing store scaled up by DPR for crispness on HiDPI.
    const dpr = devicePixelRatioSafe();
    const colors = resolveColors(el);
    const sizeCanvas = () => {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };

    sizeCanvas();

    const prep = prepareGraphLayout(graph, repo, width, height);
    const saveState = () => {
      try {
        localStorage.setItem(
          prep.storageKey,
          serializeGraphState(
            captureGraphState(prep.nodes, [...c.expanded.keys()]),
          ),
        );
      } catch {
        // storage disabled or over quota — persistence is best-effort
      }
    };

    const { sim, linkForce } = createGraphSimulation(prep.nodes, {
      degOf: prep.degOf,
      boundR: prep.boundR,
      seedOf: prep.seedOf,
      getExpanded: () => c.expanded,
      getNodeById: () => c.nodeById,
      getRingPinned: () => c.ringPinned,
      smallIds: prep.smallIds,
      viewportCenter: prep.viewportCenter,
    });

    const container = svg.append("g");

    const c: GraphController = {
      el,
      canvas,
      repo,
      svg,
      container,
      ringG: container.append("g"),
      nodeG: container.append("g"),
      nodes: prep.nodes,
      links: prep.links,
      expanded: new Map(),
      adj: new Map(),
      nodeById: new Map(),
      ringPinned: new Set(),
      ringDiscs: [],
      aggHidden: prep.aggHidden,
      forest: prep.forest,
      boundR: prep.boundR,
      seedOf: prep.seedOf,
      viewportCenter: prep.viewportCenter,
      degOf: prep.degOf,
      sim,
      linkForce,
      // Placeholder: createZoom needs `c` itself, so the real behavior is assigned right after construction, before anything reads it.
      zoom: null as unknown as d3.ZoomBehavior<SVGSVGElement, unknown>,
      focus: createFocusState(() => c.nodeById),
      drawer: createCanvasDrawer({
        ctx,
        canvas,
        dpr,
        colors,
        aggHidden: prep.aggHidden,
        aggBadges: prep.aggBadges,
      }),
      transform: d3.zoomIdentity,
      width,
      height,
      selectedIdRef,
      setSelected,
      setHover,
      setCrossings,
      saveState,
    };

    c.zoom = createZoom(c);

    svg.call(c.zoom).on("dblclick.zoom", null).style("cursor", "grab");
    // Start at identity (d3.zoom stores on node); re-run via resetSignal must clear explicitly.
    svg.call(c.zoom.transform, d3.zoomIdentity);
    c.transform = d3.zoomIdentity;
    selectedIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset selection when the graph is (re)laid out
    setSelected(null);

    wireBackgroundClick(c, () => isAggregating(c.transform.k));

    sim.on("tick", () => renderFrame(c));

    update(
      c,
      prep.restoredFromStorage,
      (fn) => {
        filterRef.current = fn;
      },
      colors.coverageTint,
    );

    // Restore expanded rings from last session and persist on layout cool for topology preservation.
    restoreExpandedRings(prep.savedExpanded, c.nodeById, (d) =>
      toggleExpand(c, d, colors.coverageTint),
    );
    sim.on("end", () => {
      saveState();
      measureCrossings(c);
    });

    const resize = new ResizeObserver(() => {
      const w = el.clientWidth || width;
      const h = el.clientHeight || height;

      // Ignore spurious resize: re-heating sim on every callback keeps it shivering.
      if (Math.abs(w - width) < 2 && Math.abs(h - height) < 2) {
        return;
      }
      width = w;
      height = h;
      c.width = w;
      c.height = h;
      sizeCanvas();
      c.drawer.draw(drawState(c));
      sim.alpha(0.3).restart();
    });

    resize.observe(el);

    return () => {
      resize.disconnect();
      sim.stop();
    };
  }, [graph, repo, resetSignal]);

  // Live search: re-apply filter without rebuild on query change.
  useEffect(() => {
    filterRef.current(searchQuery);
  }, [searchQuery]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 16,
          margin: "8px 0",
          fontSize: "var(--fs-xs)",
          color: "var(--text-muted)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {(Object.keys(COLORS) as SpecGraphNode["type"][]).map((t) => (
          <span
            key={t}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: COLORS[t],
                display: "inline-block",
              }}
            />
            {t}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>
          click to focus · double-click a spec to expand · scroll to zoom · drag
          to pan
        </span>
        {crossings !== null && <CrossingsLabel crossings={crossings} />}
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--bg-surface)",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
        <svg
          ref={ref}
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            color: "var(--text)",
            background: "transparent",
          }}
        />
        {hover && <HoverTooltip hover={hover} />}
        {selected && (
          <SelectedNodeCard
            selected={selected}
            repo={repo}
            onClose={() => {
              selectedIdRef.current = null;
              setSelected(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
