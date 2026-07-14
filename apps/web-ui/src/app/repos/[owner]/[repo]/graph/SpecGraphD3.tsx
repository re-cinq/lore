"use client";

import { memo, useEffect, useRef, useState } from "react";
import TestPreview from "./TestPreview";
import * as d3 from "d3";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type {
  SpecGraph,
  SpecGraphNode,
  SpecRing,
  RingSection,
  RingStatement,
} from "@/lib/spec-graph";
import { resolveExclusion, type Disc } from "@/lib/ring-exclusion";
import { visibleSegments } from "@/lib/segment-clip";
import { resolveSpacing, type Anchor } from "@/lib/anchor-spacing";
import {
  captureGraphState,
  applyGraphState,
  serializeGraphState,
  parseGraphState,
} from "@/lib/graph-persistence";
import {
  nodeDegrees,
  crowdedCharge,
  crowdedCollideRadius,
} from "@/lib/graph-crowding";
import {
  settleTicks,
  boundingRadius,
  connectedComponents,
  rimTargets,
  radialTree,
  separateSmallComponents,
  countCrossings,
  featureRingRadius,
} from "@/lib/graph-layout";
import { nodeMatchesQuery } from "@/lib/graph-search";
import { aggregateLeaves, shouldAggregate } from "@/lib/graph-aggregation";
import { buildContainmentForest, bundleControlIds } from "@/lib/edge-bundling";
import {
  invertPoint,
  applyPoint,
  findNodeAtPoint,
  type ZoomTransform,
} from "@/lib/graph-viewport";
import { featureStatusColor } from "../features/feature-status";
import { cssToken, resolveColor } from "@/lib/theme-token-resolve";

const RING_CLEARANCE = 24; // keep non-ring nodes this far outside every open ring
const ANCHOR_SEPARATION = 80; // min center distance between Spec/ADR nodes (and off rings)

// Below this zoom scale, single-owner leaves collapse into per-parent count
// badges (semantic zoom); at or above it they expand back to individual dots.
const LOD_THRESHOLD = 0.5;
// curveBundle straightening: 1 = fully bundled to the hierarchy spine, 0 = straight.
const BUNDLE_BETA = 0.85;
const HIT_SLOP = 4; // forgiveness (px) around a canvas leaf's radius when clicking

// The containment tree (Feature ⊃ Spec ⊃ Statement/AC) the bundler routes along.
const CONTAINMENT_KINDS = new Set([
  "in_feature",
  "in_spec",
  "in_section",
  "has_statement",
]);
// Ownership edges that anchor an otherwise tree-less leaf under its first owning
// Statement/AC, so cross-spec leaf edges have a hierarchy to bundle through.
const OWNERSHIP_KINDS = new Set([
  "validated_by",
  "implemented_by",
  "decided_by",
]);
// High-cardinality leaves rendered on the canvas layer (not the SVG skeleton).
const LEAF_CANVAS_TYPES = new Set<SpecGraphNode["type"]>([
  "TestChunk",
  "CodeChunk",
  "File",
]);

// Radial-tree-per-feature layout: each Feature is a tree centre, its subtree
// fans out one RING_GAP per hierarchy level. Feature centres are spread on a
// circle of radius boundR·FEATURE_SPREAD around the viewport; small disconnected
// components (< SMALL_COMPONENT_MAX nodes) ring the outside at boundR·RIM_FACTOR.
const RING_GAP = 100; // radius added per hierarchy level — also widens sibling spacing (more circumference)
const FEATURE_SPREAD = 0.6; // feature-tree centres sit on a circle of this × boundR around the viewport
const RIM_MARGIN = 780; // gap between the main graph's outer edge and the small-component rim
const SMALL_COMPONENT_MAX = 5; // components with fewer nodes are exiled to the rim around the main circle

type SimNode = SpecGraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & {
  kind: string;
  controlIds?: string[];
};

const TESTED_FILL = "var(--success)";
const UNTESTED_FILL = "var(--danger)";

// A spec's expansion: two concentric rings drawn around it — the inner ring is
// its Sections (sized by statement count, tinted by coverage), the outer ring is
// the individual Statements (green = tested, red = untested) grouped per section.
interface SectionArc {
  uid: string;
  heading: string;
  total: number;
  tested: number;
  d: string;
}
interface StatementArc {
  uid: string;
  tested: boolean;
  text: string;
  mid: number;
  d: string;
}
interface ExpandData {
  specPath: string;
  outerMid: number;
  outerR1: number;
  sections: SectionArc[];
  statements: StatementArc[];
}

/** Lays out a spec's two rings: section arcs (inner) + per-statement arcs (outer). */
function computeRing(specPath: string, ring: SpecRing): ExpandData {
  const TWO_PI = Math.PI * 2;
  const nSt = Math.max(ring.statements.length, 1);
  // Grow the radius with statement count so each outer arc stays clickable.
  const outerR0 = Math.max(64, Math.min(150, (nSt * 11) / TWO_PI));
  const innerR1 = outerR0 - 4;
  const innerR0 = Math.max(RADIUS.Spec + 6, innerR1 - 16);
  const outerR1 = outerR0 + 13;
  const arc = d3.arc();

  const span = new Map<string, { a0: number; a1: number }>();
  const pie = d3
    .pie<RingSection>()
    .sort(null)
    .value((s) => s.total + 1.2)(ring.sections);
  const sections: SectionArc[] = pie.map((p) => {
    span.set(p.data.uid, { a0: p.startAngle, a1: p.endAngle });

    return {
      uid: p.data.uid,
      heading: p.data.heading,
      total: p.data.total,
      tested: p.data.tested,
      d:
        arc({
          innerRadius: innerR0,
          outerRadius: innerR1,
          startAngle: p.startAngle,
          endAngle: p.endAngle,
        }) ?? "",
    };
  });

  const bySec = new Map<string, RingStatement[]>();

  for (const st of ring.statements) {
    (
      bySec.get(st.sectionUid) ??
      bySec.set(st.sectionUid, []).get(st.sectionUid)!
    ).push(st);
  }

  const statements: StatementArc[] = [];

  for (const sec of ring.sections) {
    const sp = span.get(sec.uid);
    const sts = bySec.get(sec.uid) ?? [];

    if (!sp || sts.length === 0) {
      continue;
    }
    const w = (sp.a1 - sp.a0) / sts.length;

    sts.forEach((st, i) => {
      const a0 = sp.a0 + i * w;
      const a1 = a0 + w;

      statements.push({
        uid: st.uid,
        tested: st.tested,
        text: st.text,
        mid: (a0 + a1) / 2,
        d:
          arc({
            innerRadius: outerR0,
            outerRadius: outerR1,
            startAngle: a0 + 0.004,
            endAngle: a1 - 0.004,
          }) ?? "",
      });
    });
  }

  return {
    specPath,
    outerMid: (outerR0 + outerR1) / 2,
    outerR1,
    sections,
    statements,
  };
}

const COLORS: Record<SpecGraphNode["type"], string> = {
  Feature: "var(--chart-feature)",
  Spec: "var(--chart-spec)",
  Section: "var(--chart-section)",
  Statement: "var(--chart-statement)",
  AcceptanceCriterion: "var(--chart-criterion)",
  TestChunk: "var(--chart-test)",
  CodeChunk: "var(--chart-code)",
  File: "var(--chart-code)",
  ADR: "var(--chart-adr)",
};
const RADIUS: Record<SpecGraphNode["type"], number> = {
  Feature: 20,
  Spec: 16,
  Section: 10,
  Statement: 8,
  AcceptanceCriterion: 9,
  TestChunk: 11,
  CodeChunk: 11,
  File: 12,
  ADR: 13,
};

// Persistent feature lifecycle status → node color (ADR-027): a Feature node
// backed by a lore.features row is colored by its status (via the single-source
// palette in feature-status.ts) instead of the flat Feature pink, so
// drafts/in-flight/shipped features read at a glance.

// The live projection can emit a type outside the declared union; default rather
// than index to undefined (which would NaN a radius or blank a fill).
const radiusOf = (type: SpecGraphNode["type"]): number => RADIUS[type] ?? 11;
const colorOf = (type: SpecGraphNode["type"]): string =>
  COLORS[type] ?? "var(--chart-neutral)";
// Node fill: status-colored when a Feature carries a persistent lifecycle status.
const nodeColor = (node: SpecGraphNode): string =>
  node.type === "Feature" && node.status
    ? (featureStatusColor(node.status) ?? colorOf(node.type))
    : colorOf(node.type);
const isLeafCanvas = (type: SpecGraphNode["type"]): boolean =>
  LEAF_CANVAS_TYPES.has(type);

// Only the structural nodes carry a persistent label; the numerous leaf
// artefacts (File/TestChunk/CodeChunk) have long path labels that pile into
// visual junk, so they're shown on hover/selection instead.
const LABELED_TYPES = new Set<SpecGraphNode["type"]>([
  "Feature",
  "Spec",
  "Section",
  "ADR",
]);

// Focus + context: opacity by graph distance from the selected node, fading with
// depth (level 0 = selected, then 1/2/3 hops); past 3 hops is dimmed.
const LEVEL_OPACITY = [1, 0.85, 0.5, 0.28];
const FADED = 0.07;

const idOf = (x: string | number | SimNode): string =>
  typeof x === "object" ? x.id : String(x);

function nodeLinks(
  node: SpecGraphNode,
  repo: string,
): Array<{ label: string; href: string; external: boolean }> {
  const out: Array<{ label: string; href: string; external: boolean }> = [];

  if (
    (node.type === "Spec" ||
      node.type === "Statement" ||
      node.type === "Section") &&
    node.path
  ) {
    out.push({
      label: "Open in Lore",
      href: `/specs/${encodeURIComponent(node.path)}`,
      external: false,
    });
  }

  if (node.path) {
    const line = node.line ? `#L${node.line}` : "";

    out.push({
      label: "View on GitHub",
      href: `https://github.com/${repo}/blob/HEAD/${node.path}${line}`,
      external: true,
    });
  }

  return out;
}

// Memoized so the markdown only re-parses when the text changes, not on every
// cursor move while the tooltip follows the pointer.
const HoverMarkdown = memo(function HoverMarkdown({ text }: { text: string }) {
  return (
    <div className="md-popover">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function bfsLevels(
  adj: Map<string, Set<string>>,
  startId: string,
  maxDepth: number,
): Map<string, number> {
  const level = new Map<string, number>([[startId, 0]]);
  let frontier = [startId];

  for (let d = 1; d <= maxDepth; d += 1) {
    const next: string[] = [];

    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!level.has(nb)) {
          level.set(nb, d);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }

  return level;
}

export default function SpecGraphD3({
  data,
  repo,
  searchQuery = "",
  resetSignal = 0,
}: {
  data: SpecGraph;
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
  // Edge-crossing count (layout-quality metric), recomputed when the layout
  // settles. -1 = too many edges to count cheaply, null = not measured yet.
  const [crossings, setCrossings] = useState<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  // Set inside the main effect so the search-only effect can re-run the live
  // filter without rebuilding the whole simulation.
  const filterRef = useRef<(q: string) => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    const canvas = canvasRef.current;

    if (!el || !canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }
    let width = el.clientWidth || 900;
    let height = el.clientHeight || 600;
    const svg = d3.select(el);

    svg.selectAll("*").remove();

    if (data.nodes.length === 0) {
      return;
    }

    // Canvas draws with CSS-pixel coordinates; the backing store is scaled up by
    // the device pixel ratio so edges/dots stay crisp on HiDPI screens.
    const dpr = window.devicePixelRatio || 1;
    // Canvas fillStyle/strokeStyle and d3.interpolateRgb need literal colors
    // (they cannot resolve var() strings), so theme tokens are resolved once
    // per render here; SVG attributes keep the raw var() references.
    const tokenStyles = getComputedStyle(el);
    const lookup = (name: string) => tokenStyles.getPropertyValue(name);
    const surfaceColor = cssToken(lookup, "--bg-surface", "#ffffff");
    const edgeColor = cssToken(lookup, "--chart-neutral", "#94a3b8");
    const badgeTextColor = cssToken(lookup, "--text-on-accent", "#ffffff");
    const canvasColorOf = (type: SpecGraphNode["type"]) =>
      resolveColor(lookup, colorOf(type));
    const coverageTint = d3.interpolateRgb(
      cssToken(lookup, "--danger", "#dc2626"),
      cssToken(lookup, "--success", "#16a34a"),
    );
    const sizeCanvas = () => {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };

    sizeCanvas();

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.links.map((l) => ({
      source: l.source,
      target: l.target,
      kind: l.kind,
    }));
    // Per-node degree feeds the anti-crowding rules in the force setup below
    // (see lib/graph-crowding). Computed once from the raw link list.
    const degree = nodeDegrees(data.links);
    const degOf = (x: string | number | SimNode) => degree.get(idOf(x)) ?? 1;
    const expanded = new Map<string, ExpandData>(); // spec id → its two-ring layout
    let adj = new Map<string, Set<string>>();
    let nodeById = new Map<string, SimNode>();
    let ringPinned = new Set<string>(); // statement ids pinned onto an outer ring

    // Aggregation: collapse single-owner canvas leaves into per-parent badges.
    // Computed once from the data (position-independent); applied only while the
    // view is zoomed out past LOD_THRESHOLD.
    const { hidden: aggHidden, badges: aggBadges } = aggregateLeaves(
      data.nodes,
      data.links,
      LEAF_CANVAS_TYPES,
    );

    // Bundling forest: containment tree plus a tree-home for each leaf under its
    // first owning statement, so cross-spec leaf edges route through the hierarchy.
    const forest = buildContainmentForest(data.links, CONTAINMENT_KINDS);

    for (const l of data.links) {
      if (OWNERSHIP_KINDS.has(l.kind) && !forest.has(l.target)) {
        forest.set(l.target, l.source);
      }
    }

    // Cross-cutting edges precompute their bundle spine once; containment edges
    // stay straight (the skeleton) and are drawn clipped against the rings.
    for (const l of links) {
      if (!CONTAINMENT_KINDS.has(l.kind)) {
        l.controlIds = bundleControlIds(
          forest,
          idOf(l.source as string | SimNode),
          idOf(l.target as string | SimNode),
        );
      }
    }

    // Persist the layout to localStorage so a reload restores the previous topology
    // (node positions, pins, which specs were expanded). Best-effort — storage may
    // be unavailable or hold a stale/corrupt blob, both handled by returning early.
    const STORAGE_KEY = `lore.graph:${repo}`;
    const saveState = () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          serializeGraphState(captureGraphState(nodes, [...expanded.keys()])),
        );
      } catch {
        // storage disabled or over quota — persistence is best-effort
      }
    };
    let savedExpanded: string[] = [];
    let restoredFromStorage = false;

    try {
      const saved = parseGraphState(localStorage.getItem(STORAGE_KEY));

      if (saved) {
        applyGraphState(saved, nodes);
        savedExpanded = saved.expanded;
        restoredFromStorage = true;
      }
    } catch {
      // unavailable/corrupt storage — start from a fresh force layout
    }

    // Radial-tree-per-feature layout. Invert the bundling `forest` (containment +
    // leaf ownership) into children lists, lay out one radial tree per Feature
    // around a viewport circle, and ring the leftover small components outside —
    // so the hierarchy reads as separate circular trees, not one hairball. A
    // forceX/forceY (below) holds each seeded position during relax.
    const boundR = boundingRadius(data.nodes.length, data.links.length);
    const viewportCenter = { x: width / 2, y: height / 2 };
    const childrenOf = new Map<string, string[]>();

    for (const [child, parent] of forest) {
      (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(
        child,
      );
    }

    const featureIds = data.nodes
      .filter((n) => n.type === "Feature")
      .map((n) => n.id);
    // Build each feature tree once at the origin to measure its radius, then place
    // it on a ring scaled (featureRingRadius) so the trees don't overlap — the
    // dominant edge-crossing reduction (measured ≈ -62% on the 43-feature graph).
    const localTrees = featureIds.map((id) =>
      radialTree(id, childrenOf, { center: { x: 0, y: 0 }, ringGap: RING_GAP }),
    );
    let treeRadius = 120;

    for (const tree of localTrees) {
      for (const p of tree.values()) {
        treeRadius = Math.max(treeRadius, Math.hypot(p.x, p.y));
      }
    }
    const ringR = featureRingRadius(
      featureIds.length,
      treeRadius,
      boundR * FEATURE_SPREAD,
    );
    const seed = new Map<string, { x: number; y: number }>();

    featureIds.forEach((id, i) => {
      const a = (2 * Math.PI * i) / featureIds.length;
      const center =
        featureIds.length <= 1
          ? viewportCenter
          : {
              x: viewportCenter.x + ringR * Math.cos(a),
              y: viewportCenter.y + ringR * Math.sin(a),
            };

      for (const [nodeId, p] of localTrees[i]) {
        seed.set(nodeId, { x: center.x + p.x, y: center.y + p.y });
      }
    });

    // Anything no feature tree reached (e.g. a spec with no feature) is part of
    // the main graph: seed it as a compact spiral near the centre. A LOCAL counter
    // (not the node's array index) bounds the radius, so a straggler can never fling
    // out past the rim — the bug that left small components sitting among them.
    const components = connectedComponents(
      data.nodes.map((n) => n.id),
      data.links,
    );
    const smallComponents = components.filter(
      (c) => c.length < SMALL_COMPONENT_MAX && !c.some((id) => seed.has(id)),
    );
    const smallIds = new Set(smallComponents.flat());
    let strayIndex = 0;

    for (const node of data.nodes) {
      if (seed.has(node.id) || smallIds.has(node.id)) {
        continue;
      }
      const r = 8 + strayIndex * 6;
      const a = strayIndex * 2.399963229728653;

      seed.set(node.id, {
        x: viewportCenter.x + r * Math.cos(a),
        y: viewportCenter.y + r * Math.sin(a),
      });
      strayIndex += 1;
    }

    // Add the small components LAST, on a rim beyond the extent of every node
    // already placed (feature trees + strays) — so they always ring the OUTSIDE
    // of the whole main graph, not just the feature trees.
    let mainExtent = 0;

    for (const p of seed.values()) {
      mainExtent = Math.max(
        mainExtent,
        Math.hypot(p.x - viewportCenter.x, p.y - viewportCenter.y),
      );
    }

    for (const [id, p] of rimTargets(
      smallComponents,
      viewportCenter,
      mainExtent + RIM_MARGIN,
    )) {
      seed.set(id, p);
    }

    const seedOf = (d: SimNode) => seed.get(d.id) ?? viewportCenter;

    if (!restoredFromStorage) {
      for (const n of nodes) {
        const p = seed.get(n.id) ?? viewportCenter;

        n.x = p.x;
        n.y = p.y;
      }
    }

    const linkForce = d3
      .forceLink<SimNode, SimLink>([])
      .id((d) => d.id)
      // Spec→Section/Statement (the expanded drill-down) gets more length so the
      // fanned-out children don't pile on top of each other.
      .distance((l) =>
        l.kind === "in_feature"
          ? 76
          : l.kind === "in_section" ||
              l.kind === "has_statement" ||
              l.kind === "in_spec"
            ? 62
            : 46,
      )
      // d3's standard 1/min(degree): a leaf (degree 1) is held firmly to its hub
      // so it can't drift off into a comet tail, while hub↔hub links stay loose.
      .strength(
        (l) => 1 / Math.max(1, Math.min(degOf(l.source), degOf(l.target))),
      );
    const sim = d3
      .forceSimulation<SimNode>([])
      // Heavier friction than the 0.4 default so the competing placement/charge
      // forces settle instead of overshooting and shivering.
      .velocityDecay(0.7)
      .force("link", linkForce)
      // Degree-scaled repulsion, softened for the seeded radial layout: it only
      // nudges neighbours apart, it doesn't arrange the graph — the seed +
      // forceX/forceY do. distanceMin caps the close-range spike that otherwise
      // erupts when a re-heat brings two nodes near-coincident.
      .force(
        "charge",
        d3
          .forceManyBody<SimNode>()
          .strength((d) =>
            crowdedCharge(
              d.type === "Feature" ? -320 : d.type === "Spec" ? -260 : -200,
              degOf(d),
            ),
          )
          .distanceMin(12)
          // Localise repulsion to the bound's range so the central mass can't
          // fling peripheral nodes off to infinity.
          .distanceMax(boundR),
      )
      // Radial anchoring: forceX/forceY pull each node to its seeded position
      // (tree-per-feature centre + rim), holding the circular shape while collide
      // resolves overlaps. Symmetric — no axis is privileged.
      .force("x", d3.forceX<SimNode>((d) => seedOf(d).x).strength(0.22))
      .force("y", d3.forceY<SimNode>((d) => seedOf(d).y).strength(0.22))
      // Anti-crowding rule #3: degree-scaled collision radius — busy nodes (and
      // their labels) reserve hard personal space and cannot pile up.
      .force(
        "collide",
        d3
          .forceCollide<SimNode>((d) =>
            crowdedCollideRadius(radiusOf(d.type), degOf(d)),
          )
          .strength(1),
      )
      // Spacing pass: Spec/ADR "anchor" nodes are kept clear of each other AND of
      // the open rings (resolveSpacing, gap = ANCHOR_SEPARATION); every other node
      // is just kept off the rings (resolveExclusion). Ring-owned nodes (the spec
      // itself, its pinned statements) and user-dragged nodes (fx/fy set) are exempt
      // so a dragged node never snaps back. Uses the unit-tested resolvers.
      .force("spacing", () => {
        const discs: Disc[] = [];

        for (const [specId, exp] of expanded) {
          const spec = nodeById.get(specId);

          if (spec) {
            discs.push({ x: spec.x ?? 0, y: spec.y ?? 0, r: exp.outerR1 });
          }
        }
        const anchors: Anchor[] = [];

        for (const n of nodes) {
          if (n.type === "Feature" || n.type === "Spec" || n.type === "ADR") {
            anchors.push({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 });
          }
        }

        for (const n of nodes) {
          if (
            expanded.has(n.id) ||
            ringPinned.has(n.id) ||
            n.fx != null ||
            n.fy != null
          ) {
            continue;
          }
          const isAnchor =
            n.type === "Feature" || n.type === "Spec" || n.type === "ADR";
          const safe = isAnchor
            ? resolveSpacing(
                { id: n.id, x: n.x ?? 0, y: n.y ?? 0 },
                anchors,
                discs,
                ANCHOR_SEPARATION,
              )
            : resolveExclusion(
                { x: n.x ?? 0, y: n.y ?? 0 },
                discs,
                RING_CLEARANCE,
              );

          if (safe.x === n.x && safe.y === n.y) {
            continue;
          }
          n.x = safe.x;
          n.y = safe.y;
          n.vx = 0; // kill velocity so the integration step can't pull it back in
          n.vy = 0;
        }
      })
      // Hard separation: keep every small-component node strictly OUTSIDE the main
      // graph. separateSmallComponents measures the main graph's CURRENT radius
      // (it grows as the layout relaxes) and pushes any small node that has drifted
      // inside back out beyond it — so a fixed seed margin can't be eaten by
      // expansion. Dragged nodes (fx/fy set) are exempt. Unit-tested.
      .force("separate", () => {
        if (smallIds.size === 0) {
          return;
        }
        const placed = nodes
          .filter((n) => n.fx == null && n.fy == null)
          .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));

        for (const [id, p] of separateSmallComponents(
          placed,
          smallIds,
          viewportCenter,
          RIM_MARGIN,
        )) {
          const n = nodeById.get(id);

          if (!n) {
            continue;
          }
          n.x = p.x;
          n.y = p.y;
          n.vx = 0;
          n.vy = 0;
        }
      });

    const container = svg.append("g");
    const ringG = container.append("g"); // section/statement rings, under the nodes
    const nodeG = container.append("g"); // structural nodes only (leaves live on canvas)

    // Open-ring discs (one per expanded spec), rebuilt each tick. Edge paths are
    // clipped against these via the unit-tested `visibleSegments`, so no edge is
    // ever drawn inside a ring — it attaches to the ring's edge instead.
    let ringDiscs: Disc[] = [];

    // Current view transform (mirrored from d3.zoom) — drives both the SVG group
    // and the canvas draw, and inverts pointer coords for canvas hit-testing.
    let transform = d3.zoomIdentity;
    // Focus + search visual state, shared by the SVG skeleton and the canvas draw.
    let focusLevels: Map<string, number> | null = null;
    let searchTerm = "";
    const matchesSearch = (id: string) => {
      const n = nodeById.get(id);

      return n ? nodeMatchesQuery(n, searchTerm) : false;
    };
    const nodeOpacity = (id: string): number => {
      if (searchTerm.trim()) {
        return matchesSearch(id) ? 1 : FADED;
      }

      if (!focusLevels) {
        return 1;
      }
      const lv = focusLevels.get(id);

      return lv === undefined ? FADED : (LEVEL_OPACITY[lv] ?? FADED);
    };
    const edgeOpacity = (sourceId: string, targetId: string): number => {
      if (searchTerm.trim()) {
        return matchesSearch(sourceId) && matchesSearch(targetId) ? 0.5 : FADED;
      }

      if (!focusLevels) {
        return 0.5;
      }
      const ls = focusLevels.get(sourceId);
      const lt = focusLevels.get(targetId);

      if (ls === undefined || lt === undefined) {
        return FADED;
      }

      return 0.6 * (LEVEL_OPACITY[Math.max(ls, lt)] ?? FADED);
    };

    // Leaf nodes currently drawn on the canvas (and thus eligible for click
    // hit-testing) — excludes the single-owner leaves collapsed into badges.
    const aggregating = () => shouldAggregate(transform.k, LOD_THRESHOLD);
    const visibleLeaf = (n: SimNode) =>
      isLeafCanvas(n.type) && !(aggregating() && aggHidden.has(n.id));

    const bundleLine = d3
      .line<[number, number]>()
      .curve(d3.curveBundle.beta(BUNDLE_BETA))
      .context(ctx);

    function draw() {
      const collapsing = aggregating();

      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // World-space pass: edges then leaf dots, under the zoom transform.
      ctx!.save();
      ctx!.scale(dpr, dpr);
      ctx!.translate(transform.x, transform.y);
      ctx!.scale(transform.k, transform.k);

      ctx!.lineWidth = 1.3 / transform.k;

      for (const l of links) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        const sId = idOf(s);
        const tId = idOf(t);

        // Skip edges into a ring-represented statement or a collapsed leaf.
        if (l.kind === "in_spec" && ringPinned.has(tId)) {
          continue;
        }

        if (collapsing && (aggHidden.has(sId) || aggHidden.has(tId))) {
          continue;
        }
        const op = edgeOpacity(sId, tId);

        if (op <= FADED) {
          continue;
        }
        ctx!.globalAlpha = op;
        ctx!.strokeStyle = edgeColor;

        if (l.controlIds && l.controlIds.length > 2) {
          const pts = l.controlIds
            .map((id) => nodeById.get(id))
            .filter((n): n is SimNode => !!n)
            .map((n) => [n.x ?? 0, n.y ?? 0] as [number, number]);

          if (pts.length > 2) {
            ctx!.beginPath();
            bundleLine(pts);
            ctx!.stroke();
            continue;
          }
        }
        // Straight edge, clipped so it never crosses an open ring's interior.
        const pieces = visibleSegments(
          { x: s.x ?? 0, y: s.y ?? 0 },
          { x: t.x ?? 0, y: t.y ?? 0 },
          ringDiscs,
        );

        ctx!.beginPath();

        for (const p of pieces) {
          ctx!.moveTo(p.a.x, p.a.y);
          ctx!.lineTo(p.b.x, p.b.y);
        }
        ctx!.stroke();
      }

      ctx!.lineWidth = 1.5 / transform.k;

      for (const n of nodes) {
        if (!isLeafCanvas(n.type)) {
          continue;
        }

        if (collapsing && aggHidden.has(n.id)) {
          continue;
        }
        const op = nodeOpacity(n.id);

        if (op <= 0) {
          continue;
        }
        ctx!.globalAlpha = op;
        ctx!.fillStyle = canvasColorOf(n.type);
        ctx!.beginPath();
        ctx!.arc(n.x ?? 0, n.y ?? 0, radiusOf(n.type), 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = surfaceColor;
        ctx!.stroke();
      }
      ctx!.restore();

      // Screen-space pass: count badges over each collapsed parent, sized in CSS
      // pixels (not world units) so they stay readable while zoomed out.
      if (collapsing) {
        ctx!.save();
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.globalAlpha = 1;
        ctx!.font = "600 10px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";

        for (const badge of aggBadges) {
          const parent = nodeById.get(badge.parentId);

          if (!parent) {
            continue;
          }
          const screen = applyPoint(transform as ZoomTransform, {
            x: parent.x ?? 0,
            y: parent.y ?? 0,
          });
          const px = screen.x + radiusOf(parent.type) + 8;
          const py = screen.y - radiusOf(parent.type);

          ctx!.fillStyle = canvasColorOf(badge.type);
          ctx!.beginPath();
          ctx!.arc(px, py, 8, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = badgeTextColor;
          ctx!.fillText(String(badge.count), px, py + 0.5);
        }
        ctx!.restore();
      }
    }

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on("zoom", (event) => {
        transform = event.transform;
        container.attr("transform", transform.toString());
        draw();
      });

    svg.call(zoom).on("dblclick.zoom", null).style("cursor", "grab");
    // Start (and reset) at identity — d3.zoom stores its transform on the node, so
    // a re-run (e.g. the Reset button bumping resetSignal) must clear it explicitly.
    svg.call(zoom.transform, d3.zoomIdentity);
    transform = d3.zoomIdentity;
    selectedIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset selection when the graph is (re)laid out
    setSelected(null);

    const leafHitNodes = () =>
      nodes.filter(visibleLeaf).map((n) => ({
        id: n.id,
        x: n.x ?? 0,
        y: n.y ?? 0,
        r: radiusOf(n.type),
      }));

    // The SVG covers the canvas, so canvas leaves can't receive DOM events — a
    // background click instead inverts the pointer and hit-tests the leaf dots.
    svg.on("click", (event: PointerEvent) => {
      const [px, py] = d3.pointer(event, el);
      const world = invertPoint(transform as ZoomTransform, { x: px, y: py });
      const hitId = findNodeAtPoint(world, leafHitNodes(), HIT_SLOP);
      const hit = hitId ? nodeById.get(hitId) : undefined;

      if (hit) {
        selectedIdRef.current = hit.id;
        setSelected(hit);
        highlight(hit.id);
        centerOn(hit);

        return;
      }
      selectedIdRef.current = null;
      setSelected(null);
      clearHighlight();
    });

    const centerOn = (d: SimNode) => {
      const k = 1.4;
      const t = d3.zoomIdentity
        .translate(width / 2 - (d.x ?? 0) * k, height / 2 - (d.y ?? 0) * k)
        .scale(k);

      svg.transition().duration(500).call(zoom.transform, t);
    };

    function buildAdj() {
      adj = new Map();

      for (const l of links) {
        const s = idOf(l.source as string | SimNode);
        const t = idOf(l.target as string | SimNode);

        (adj.get(s) ?? adj.set(s, new Set()).get(s)!).add(t);
        (adj.get(t) ?? adj.set(t, new Set()).get(t)!).add(s);
      }
    }

    // Apply the current focus/search state to the SVG skeleton, then repaint the
    // canvas (edges + leaves) which reads the same nodeOpacity/edgeOpacity.
    function applyVisualState() {
      nodeG
        .selectAll<SVGGElement, SimNode>("g")
        .attr("opacity", (d) => nodeOpacity(d.id));
      nodeG
        .selectAll<SVGCircleElement, SimNode>("circle")
        .attr("stroke-width", (d) => (d.id === selectedIdRef.current ? 4 : 2));
      draw();
    }

    function highlight(startId: string) {
      focusLevels = bfsLevels(adj, startId, 3);
      applyVisualState();
    }

    function clearHighlight() {
      focusLevels = null;
      applyVisualState();
    }

    // Live search filter: an empty query falls back to the current focus state
    // (selection highlight, or everything visible).
    function applyFilter(query: string) {
      searchTerm = query;
      applyVisualState();
    }

    // Hide the force-nodes that the rings now represent: a pinned statement is
    // drawn as an outer-ring arc instead of a skeleton node.
    function applyRingState() {
      ringPinned = new Set<string>();

      for (const exp of expanded.values()) {
        for (const s of exp.statements) {
          ringPinned.add(s.uid);
        }
      }
      nodeG
        .selectAll<SVGGElement, SimNode>("g")
        .style("display", (d) => (ringPinned.has(d.id) ? "none" : ""));
    }

    function renderRings() {
      const sel = ringG
        .selectAll<SVGGElement, [string, ExpandData]>("g.ring")
        .data([...expanded.entries()], (d) => d[0]);

      sel.exit().remove();
      sel
        .enter()
        .append("g")
        .attr("class", "ring")
        .merge(sel)
        .each(function (entry) {
          const exp = entry[1];
          const g = d3.select(this);

          g.selectAll<SVGPathElement, SectionArc>("path.sec")
            .data(exp.sections, (s) => s.uid)
            .join("path")
            .attr("class", "sec")
            .attr("d", (s) => s.d)
            .attr("fill", (s) =>
              s.total > 0
                ? coverageTint(s.tested / s.total)
                : "var(--chart-neutral)",
            )
            .attr("fill-opacity", 0.5)
            .attr("stroke", "var(--bg-surface)")
            .attr("stroke-width", 1)
            .style("cursor", "pointer")
            .on("click", (event: PointerEvent, s) => {
              event.stopPropagation();
              selectedIdRef.current = null;
              setSelected({
                id: s.uid,
                type: "Section",
                label: s.heading,
                path: exp.specPath,
              });
            })
            .on("mouseenter mousemove", (event: PointerEvent, s) => {
              const [px, py] = d3.pointer(event, el);

              setHover({
                text: `${s.heading} — ${s.tested}/${s.total} tested`,
                x: px,
                y: py,
              });
            })
            .on("mouseleave", () => setHover(null));
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
              selectedIdRef.current = null;
              setSelected({
                id: s.uid,
                type: "Statement",
                label: "",
                detail: s.text,
                path: exp.specPath,
              });
            })
            .on("mouseenter mousemove", (event: PointerEvent, s) => {
              const [px, py] = d3.pointer(event, el);

              setHover({ text: s.text || "(statement)", x: px, y: py });
            })
            .on("mouseleave", () => setHover(null));
        });
    }

    async function toggleExpand(d: SimNode) {
      if (d.type !== "Spec" || !d.path) {
        return;
      }

      if (expanded.has(d.id)) {
        expanded.delete(d.id);
        d.fx = null;
        d.fy = null;
        applyRingState();
        renderRings();
        sim.alpha(0.4).restart();
        saveState();

        return;
      }
      // Pin the spec so the ring stays put — the simulation restart would otherwise
      // drift it, and the second double-click (to collapse) would miss.
      d.fx = d.x;
      d.fy = d.y;
      const res = await fetch(
        `/api/repos/${repo}/spec-ring?spec=${encodeURIComponent(d.path)}`,
      );

      if (!res.ok) {
        return;
      }
      const ring = (await res.json()) as SpecRing;

      if (ring.sections.length === 0 && ring.statements.length === 0) {
        return;
      }
      expanded.set(d.id, computeRing(d.path, ring));
      applyRingState();
      renderRings();
      sim.alpha(0.5).restart();
      saveState();
    }

    // Layout-quality probe: count straight-segment edge crossings at the settled
    // positions and surface it in the UI. O(E²), so skip very dense graphs.
    const CROSSINGS_EDGE_CAP = 2500;

    function measureCrossings() {
      if (links.length > CROSSINGS_EDGE_CAP) {
        setCrossings(-1);

        return;
      }
      const pos = new Map(
        nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
      );
      const edges = links.map((l) => ({
        source: idOf(l.source as string | SimNode),
        target: idOf(l.target as string | SimNode),
      }));

      setCrossings(countCrossings(edges, pos));
    }

    function update() {
      sim.nodes(nodes);
      linkForce.links(links);

      nodeG
        .selectAll<SVGGElement, SimNode>("g")
        .data(
          nodes.filter((n) => !isLeafCanvas(n.type)),
          (d) => d.id,
        )
        .join((enter) => {
          const g = enter
            .append("g")
            .style("cursor", "pointer")
            .on("click", (event: PointerEvent, d) => {
              event.stopPropagation();
              selectedIdRef.current = d.id;
              setSelected(d);
              highlight(d.id);
              centerOn(d);
            })
            .on("dblclick", (event: PointerEvent, d) => {
              event.stopPropagation();
              void toggleExpand(d);
            })
            .on("mouseenter mousemove", (event: PointerEvent, d) => {
              const text = (d.detail?.trim() || d.label || d.path || "").trim();

              if (!text) {
                setHover(null);

                return;
              }
              const [px, py] = d3.pointer(event, el);

              setHover({ text, x: px, y: py });
            })
            .on("mouseleave", () => setHover(null))
            .call(
              d3
                .drag<SVGGElement, SimNode>()
                // Elastic drag: gently re-heat so link springs tug the dragged
                // node's neighbours along, while the seed forces (forceX/forceY)
                // pull everything back toward its home — springy, not explosive.
                // The earlier eruption was the layered layout's strong forces +
                // tight spacing; the radial seed + distanceMin keep this stable.
                .on("start", (event, d) => {
                  if (!event.active) {
                    sim.alphaTarget(0.1).restart();
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
                    sim.alphaTarget(0);
                  }
                  // Leave fx/fy pinned at the drop point — a dragged node stays put.
                  saveState();
                }),
            );

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
        });

      buildAdj();
      nodeById = new Map(nodes.map((n) => [n.id, n]));
      applyRingState();
      filterRef.current = applyFilter;

      // Pre-warm a fresh layout headless so the first painted frame is already
      // relaxed: sim.tick() advances the layout without firing the 'tick'
      // renderer. Restored layouts are already settled. Either way we then start
      // at alpha 0 — one render at the settled positions, no visible reshuffle
      // (user gestures: drag/expand/resize re-energise the sim as before).
      if (!restoredFromStorage) {
        const warm = settleTicks(nodes.length);

        for (let i = 0; i < warm; i += 1) {
          sim.tick();
        }
      }
      sim.alpha(0).restart();

      if (selectedIdRef.current && adj.has(selectedIdRef.current)) {
        highlight(selectedIdRef.current);
      } else {
        draw();
      }
      measureCrossings();
    }

    // One frame: ring-spoke placement, SVG transforms, and the canvas draw.
    // Driven by the simulation tick, and called directly during a manual drag.
    function renderFrame() {
      // Pin each expanded spec's statements onto its outer ring (which tracks the
      // spec), and fan their related test/code/ADR nodes radially OUTWARD at the
      // same angle — so every edge is a short spoke outside the ring, never a chord
      // crossing the (now clean) interior.
      for (const [specId, exp] of expanded) {
        const spec = nodeById.get(specId);

        if (!spec) {
          continue;
        }
        const cx = spec.x ?? 0;
        const cy = spec.y ?? 0;

        for (const s of exp.statements) {
          const n = nodeById.get(s.uid);

          if (n) {
            n.x = cx + exp.outerMid * Math.sin(s.mid);
            n.y = cy - exp.outerMid * Math.cos(s.mid);
            n.vx = 0;
            n.vy = 0;
          }
          let k = 0;

          for (const nb of adj.get(s.uid) ?? []) {
            if (ringPinned.has(nb) || expanded.has(nb)) {
              continue;
            }
            const leaf = nodeById.get(nb);

            // Only test/code chunks get spoked onto the ring. ADRs are anchors —
            // they go through the spacing force (kept apart + off rings), never spoked.
            if (
              !leaf ||
              (leaf.type !== "TestChunk" && leaf.type !== "CodeChunk")
            ) {
              continue;
            }

            // Only hard-place leaves owned by a single statement (clean radial
            // spokes). Shared chunks float; their edges are clipped to the ring
            // edge by visibleSegments.
            if ((adj.get(nb)?.size ?? 0) !== 1) {
              continue;
            }
            const r = exp.outerR1 + 32 + k * 34;

            leaf.x = cx + r * Math.sin(s.mid);
            leaf.y = cy - r * Math.cos(s.mid);
            leaf.vx = 0;
            leaf.vy = 0;
            k += 1;
          }
        }
      }
      ringDiscs = [];

      for (const [specId, exp] of expanded) {
        const spec = nodeById.get(specId);

        if (spec) {
          ringDiscs.push({ x: spec.x ?? 0, y: spec.y ?? 0, r: exp.outerR1 });
        }
      }
      nodeG
        .selectAll<SVGGElement, SimNode>("g")
        .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      ringG
        .selectAll<SVGGElement, [string, ExpandData]>("g.ring")
        .attr("transform", (entry) => {
          const spec = nodeById.get(entry[0]);

          return `translate(${spec?.x ?? 0},${spec?.y ?? 0})`;
        });
      draw();
    }
    sim.on("tick", renderFrame);

    update();

    // Re-open the rings that were expanded last session, and persist whenever the
    // layout cools so the next reload restores this exact topology.
    for (const id of savedExpanded) {
      const spec = nodeById.get(id);

      if (spec) {
        void toggleExpand(spec);
      }
    }
    sim.on("end", () => {
      saveState();
      measureCrossings();
    });

    const resize = new ResizeObserver(() => {
      const w = el.clientWidth || width;
      const h = el.clientHeight || height;

      // Ignore sub-pixel / spurious resize callbacks — re-heating the sim on
      // every one keeps it perpetually shivering.
      if (Math.abs(w - width) < 2 && Math.abs(h - height) < 2) {
        return;
      }
      width = w;
      height = h;
      sizeCanvas();
      draw();
      sim.alpha(0.3).restart();
    });

    resize.observe(el);

    return () => {
      resize.disconnect();
      sim.stop();
    };
  }, [data, repo, resetSignal]);

  // Live search: re-apply the filter without rebuilding the simulation. Runs on
  // mount (restoring the empty-query full view) and on every query change.
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
        {crossings !== null && (
          <span title="straight-segment edge crossings at the settled layout (lower is clearer)">
            · {crossings < 0 ? "crossings: n/a" : `${crossings} crossings`}
          </span>
        )}
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
        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.min(hover.x + 14, 9999),
              top: hover.y + 14,
              maxWidth: 320,
              pointerEvents: "none",
              padding: "6px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--text)",
              boxShadow: "var(--shadow-lg)",
              fontSize: "var(--fs-xs)",
              lineHeight: 1.4,
              maxHeight: 240,
              overflow: "hidden",
              zIndex: 10,
            }}
          >
            <HoverMarkdown text={hover.text} />
          </div>
        )}
        {selected && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, 28px)",
              maxWidth: 420,
              maxHeight: 320,
              overflow: "auto",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--text)",
              boxShadow: "var(--shadow-lg)",
              fontSize: "var(--fs-sm)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: colorOf(selected.type),
                  display: "inline-block",
                }}
              />
              <strong>{selected.type}</strong>
              {selected.type === "Spec" && (
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "var(--fs-xs)",
                  }}
                >
                  · double-click to expand
                </span>
              )}
              <button
                onClick={() => {
                  selectedIdRef.current = null;
                  setSelected(null);
                }}
                style={{
                  marginLeft: "auto",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "var(--fs-base)",
                  lineHeight: 1,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {selected.label && (
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {selected.label}
              </div>
            )}
            {selected.detail && (
              <div
                className="md-popover"
                style={{ marginBottom: 8, lineHeight: 1.5 }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {selected.detail}
                </ReactMarkdown>
              </div>
            )}
            {selected.path && (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  fontSize: "var(--fs-xs)",
                  marginBottom: 8,
                  wordBreak: "break-all",
                }}
              >
                {selected.path}
                {selected.line ? `:${selected.line}` : ""}
              </div>
            )}
            {selected.type === "TestChunk" &&
              selected.path &&
              selected.line && (
                <div style={{ marginBottom: 8 }}>
                  <TestPreview
                    repo={repo}
                    path={selected.path}
                    start={selected.line}
                    end={selected.endLine}
                  />
                </div>
              )}
            <div style={{ display: "flex", gap: 12 }}>
              {nodeLinks(selected, repo).map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target={l.external ? "_blank" : undefined}
                  rel={l.external ? "noreferrer" : undefined}
                  style={{ color: "var(--accent)" }}
                >
                  {l.label} →
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
