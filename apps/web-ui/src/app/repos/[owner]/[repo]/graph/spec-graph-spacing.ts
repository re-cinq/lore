import { resolveExclusion, type Disc } from "@/lib/ring-exclusion";
import { resolveSpacing, type Anchor } from "@/lib/anchor-spacing";
import type { SimNode } from "./spec-graph-visual";
import { RING_CLEARANCE, ANCHOR_SEPARATION } from "./spec-graph-visual";
import type { ExpandData } from "./spec-graph-ring-layout";

/** The per-tick spacing force: keeps anchor nodes apart and everything else clear of open rings. */

function collectRingDiscs(
  expanded: Map<string, ExpandData>,
  nodeById: Map<string, SimNode>,
): Disc[] {
  const discs: Disc[] = [];

  for (const [specId, exp] of expanded) {
    const spec = nodeById.get(specId);

    if (spec) {
      discs.push({ x: spec.x ?? 0, y: spec.y ?? 0, r: exp.outerR1 });
    }
  }

  return discs;
}

// Feature/Spec/ADR nodes anchor the layout — spread apart from each other, everything else just stays off rings.
function nodeIsAnchorType(n: SimNode): boolean {
  return n.type === "Feature" || n.type === "Spec" || n.type === "ADR";
}

function collectAnchors(nodes: SimNode[]): Anchor[] {
  const anchors: Anchor[] = [];

  for (const n of nodes) {
    if (nodeIsAnchorType(n)) {
      anchors.push({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 });
    }
  }

  return anchors;
}

function nodeIsPinned(n: SimNode): boolean {
  return n.fx != null || n.fy != null;
}

// Expanded specs, ring-pinned statements, and drag-pinned nodes sit still — the spacing pass never moves them.
function nodeIsSpacingFixed(
  n: SimNode,
  expanded: Map<string, ExpandData>,
  ringPinned: Set<string>,
): boolean {
  return expanded.has(n.id) || ringPinned.has(n.id) || nodeIsPinned(n);
}

function resolveSafePosition(
  n: SimNode,
  isAnchor: boolean,
  anchors: Anchor[],
  discs: Disc[],
): { x: number; y: number } {
  return isAnchor
    ? resolveSpacing(
        { id: n.id, x: n.x ?? 0, y: n.y ?? 0 },
        anchors,
        discs,
        ANCHOR_SEPARATION,
      )
    : resolveExclusion({ x: n.x ?? 0, y: n.y ?? 0 }, discs, RING_CLEARANCE);
}

interface SpacingContext {
  anchors: Anchor[];
  discs: Disc[];
  expanded: Map<string, ExpandData>;
  ringPinned: Set<string>;
}

// One node's spacing-pass relaxation: fixed nodes are skipped, everyone else is nudged clear of anchors/rings.
function relaxNodeSpacing(n: SimNode, spacing: SpacingContext): void {
  if (nodeIsSpacingFixed(n, spacing.expanded, spacing.ringPinned)) {
    return;
  }
  const safe = resolveSafePosition(
    n,
    nodeIsAnchorType(n),
    spacing.anchors,
    spacing.discs,
  );

  if (safe.x === n.x && safe.y === n.y) {
    return;
  }
  n.x = safe.x;
  n.y = safe.y;
  n.vx = 0; // kill velocity so the integration step can't pull it back in
  n.vy = 0;
}

// Spacing pass: anchors kept clear of each other & rings (resolveSpacing); others just off rings.
export function applySpacingForce(
  nodes: SimNode[],
  expanded: Map<string, ExpandData>,
  nodeById: Map<string, SimNode>,
  ringPinned: Set<string>,
): void {
  const spacing: SpacingContext = {
    discs: collectRingDiscs(expanded, nodeById),
    anchors: collectAnchors(nodes),
    expanded,
    ringPinned,
  };

  for (const n of nodes) {
    relaxNodeSpacing(n, spacing);
  }
}
