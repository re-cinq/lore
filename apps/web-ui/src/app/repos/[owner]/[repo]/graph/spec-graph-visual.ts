import * as d3 from "d3";
import type { SpecGraphNode } from "@/lib/spec-graph";
import { featureStatusColor } from "../features/feature-status";

/** Static visual config for the graph: node colors/radii/labels, focus-opacity levels, force-tuning constants. */

export const RING_CLEARANCE = 24;
export const ANCHOR_SEPARATION = 80;

// Below this zoom, leaves collapse into per-parent count badges (semantic zoom); above they expand back.
export const LOD_THRESHOLD = 0.5;
// curveBundle straightening: 1 = fully bundled to the hierarchy spine, 0 = straight.
export const BUNDLE_BETA = 0.85;
export const HIT_SLOP = 4; // forgiveness (px) around a canvas leaf's radius when clicking

// Containment tree (Feature ⊃ Spec ⊃ Statement/AC) the bundler routes along.
export const CONTAINMENT_KINDS = new Set([
  "in_feature",
  "in_spec",
  "in_section",
  "has_statement",
]);
// Ownership edges anchor tree-less leaf under owning Statement/AC so cross-spec edges have bundling hierarchy.
export const OWNERSHIP_KINDS = new Set([
  "validated_by",
  "implemented_by",
  "decided_by",
]);
// High-cardinality leaves rendered on the canvas layer (not the SVG skeleton).
export const LEAF_CANVAS_TYPES = new Set<SpecGraphNode["type"]>([
  "TestChunk",
  "CodeChunk",
  "File",
]);

// Radial-tree layout: Feature tree-centres spread on circle of boundR·FEATURE_SPREAD; small components on rim.
export const RING_GAP = 100;
export const FEATURE_SPREAD = 0.6;
export const RIM_MARGIN = 780;
export const SMALL_COMPONENT_MAX = 5;

export type SimNode = SpecGraphNode & d3.SimulationNodeDatum;
export type SimLink = d3.SimulationLinkDatum<SimNode> & {
  kind: string;
  controlIds?: string[];
};

export const TESTED_FILL = "var(--success)";
export const UNTESTED_FILL = "var(--danger)";

export const COLORS: Record<SpecGraphNode["type"], string> = {
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
export const RADIUS: Record<SpecGraphNode["type"], number> = {
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

// Feature node color by lifecycle status (ADR-027): single-source palette from feature-status.ts.
export const radiusOf = (type: SpecGraphNode["type"]): number => RADIUS[type];
export const colorOf = (type: SpecGraphNode["type"]): string => COLORS[type];
// Node fill: status-colored when a Feature carries a persistent lifecycle status.
export const nodeColor = (node: SpecGraphNode): string =>
  node.type === "Feature" && node.status
    ? (featureStatusColor(node.status) ?? colorOf(node.type))
    : colorOf(node.type);
export const isLeafCanvas = (type: SpecGraphNode["type"]): boolean =>
  LEAF_CANVAS_TYPES.has(type);

// Structural nodes only get persistent labels; leaves show long paths on hover/selection.
export const LABELED_TYPES = new Set<SpecGraphNode["type"]>([
  "Feature",
  "Spec",
  "Section",
  "ADR",
]);

// Focus + context: opacity by graph distance from selected node (0=selected, 1-3 hops, 3+ dimmed).
export const LEVEL_OPACITY = [1, 0.85, 0.5, 0.28];
export const FADED = 0.07;

/** Edge opacity from the two endpoints' focus levels: faded when either side has none. */
export function levelPairOpacity(
  sourceLevel: number | undefined,
  targetLevel: number | undefined,
): number {
  if (sourceLevel === undefined || targetLevel === undefined) {
    return FADED;
  }

  return 0.6 * (LEVEL_OPACITY[Math.max(sourceLevel, targetLevel)] ?? FADED);
}

/** Only test/code chunks get spoked onto a ring; ADRs are anchors (spacing force, never spoked). */
export function isSpokeableLeafType(leaf: SimNode): boolean {
  return leaf.type === "TestChunk" || leaf.type === "CodeChunk";
}

/** Only hard-place leaves with a single owner (clean radial spokes); shared chunks float. */
export function hasSingleOwner(
  nb: string,
  adj: Map<string, Set<string>>,
): boolean {
  return (adj.get(nb)?.size ?? 0) === 1;
}

export const idOf = (node: string | number | SimNode): string =>
  typeof node === "object" ? node.id : String(node);

// Spec's expansion drill-down gets more length so children don't pile.
export function linkDistance(kind: SimLink["kind"]): number {
  if (kind === "in_feature") {
    return 76;
  }

  if (kind === "in_section" || kind === "has_statement" || kind === "in_spec") {
    return 62;
  }

  return 46;
}

export function chargeBase(nodeType: SimNode["type"]): number {
  if (nodeType === "Feature") {
    return -320;
  }

  if (nodeType === "Spec") {
    return -260;
  }

  return -200;
}

export function bfsLevels(
  adj: Map<string, Set<string>>,
  startId: string,
  maxDepth: number,
): Map<string, number> {
  const level = new Map<string, number>([[startId, 0]]);
  let frontier = [startId];

  for (let d = 1; d <= maxDepth; d += 1) {
    const next: string[] = [];

    frontier.forEach((id) => {
      adj.get(id)?.forEach((nb) => {
        if (!level.has(nb)) {
          level.set(nb, d);
          next.push(nb);
        }
      });
    });
    frontier = next;
  }

  return level;
}
