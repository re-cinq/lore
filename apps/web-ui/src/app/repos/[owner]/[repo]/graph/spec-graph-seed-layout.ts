import type { SpecGraph } from "@/lib/spec-graph";
import { applyGraphState, parseGraphState } from "@/lib/graph-persistence";
import { bundleControlIds } from "@/lib/edge-bundling";
import { idOf, type SimNode, type SimLink } from "./spec-graph-visual";

/** Pre-simulation setup: DOM target resolution, the bundling forest, saved-state restore, and initial node seeding. */

export type Point = { x: number; y: number };

/** SVG + canvas + a live 2D context, or null when the DOM isn't ready to draw into yet. */
export function resolveRenderTargets(
  el: SVGSVGElement | null,
  canvas: HTMLCanvasElement | null,
): {
  el: SVGSVGElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (!el || !canvas) {
    return null;
  }
  const ctx = canvas.getContext("2d");

  return ctx ? { el, canvas, ctx } : null;
}

// Ownership edges anchor tree-less leaves under their owning Statement/AC, extending the containment forest in place.
export function withOwnershipForest(
  forest: Map<string, string>,
  links: SpecGraph["links"],
  ownershipKinds: Set<string>,
): Map<string, string> {
  for (const l of links) {
    if (ownershipKinds.has(l.kind) && !forest.has(l.target)) {
      forest.set(l.target, l.source);
    }
  }

  return forest;
}

// Cross-cutting edges precompute a bundle spine through the containment forest; containment edges stay straight.
export function withBundleControlIds(
  links: SimLink[],
  forest: Map<string, string>,
  containmentKinds: Set<string>,
): SimLink[] {
  for (const l of links) {
    if (!containmentKinds.has(l.kind)) {
      l.controlIds = bundleControlIds(
        forest,
        idOf(l.source as string | SimNode),
        idOf(l.target as string | SimNode),
      );
    }
  }

  return links;
}

/** Best-effort restore of a prior session's node positions + expanded rings from localStorage. */
export function tryRestoreGraphState(
  storageKey: string,
  nodes: SimNode[],
): { savedExpanded: string[]; restoredFromStorage: boolean } {
  try {
    const saved = parseGraphState(localStorage.getItem(storageKey));

    if (saved) {
      applyGraphState(saved, nodes);

      return { savedExpanded: saved.expanded, restoredFromStorage: true };
    }
  } catch {
    // unavailable/corrupt storage — start from a fresh force layout
  }

  return { savedExpanded: [], restoredFromStorage: false };
}

// Inverts the containment forest (child → parent) into children lists (parent → children) for radial-tree layout.
export function buildChildrenMap(
  forest: Map<string, string>,
): Map<string, string[]> {
  const childrenOf = new Map<string, string[]>();

  for (const [child, parent] of forest) {
    (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(
      child,
    );
  }

  return childrenOf;
}

// Unreached nodes: seed as a spiral near center with a local counter to bound the radius.
export function seedStrayNodes(
  nodes: readonly { id: string }[],
  seed: Map<string, Point>,
  smallIds: Set<string>,
  viewportCenter: Point,
): void {
  let strayIndex = 0;

  for (const node of nodes) {
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
}

export function computeMainExtent(
  seed: Map<string, Point>,
  viewportCenter: Point,
): number {
  let mainExtent = 0;

  for (const p of seed.values()) {
    mainExtent = Math.max(
      mainExtent,
      Math.hypot(p.x - viewportCenter.x, p.y - viewportCenter.y),
    );
  }

  return mainExtent;
}

export function applyRimTargets(
  seed: Map<string, Point>,
  rim: Iterable<[string, Point]>,
): void {
  for (const [id, p] of rim) {
    seed.set(id, p);
  }
}

// Force-simulation start positions: the radial-tree/rim seed when available, else the viewport center.
export function seedInitialPositions(
  nodes: SimNode[],
  seed: Map<string, Point>,
  viewportCenter: Point,
): void {
  for (const n of nodes) {
    const p = seed.get(n.id) ?? viewportCenter;

    n.x = p.x;
    n.y = p.y;
  }
}

export function elementSize(el: SVGSVGElement): {
  width: number;
  height: number;
} {
  return { width: el.clientWidth || 900, height: el.clientHeight || 600 };
}

export function devicePixelRatioSafe(): number {
  return window.devicePixelRatio || 1;
}

// Restore expanded rings from last session; each toggle re-fetches + lays out that spec's ring.
export function restoreExpandedRings(
  savedExpanded: readonly string[],
  nodeById: Map<string, SimNode>,
  toggleExpand: (d: SimNode) => Promise<void>,
): void {
  for (const id of savedExpanded) {
    const spec = nodeById.get(id);

    if (spec) {
      void toggleExpand(spec);
    }
  }
}
