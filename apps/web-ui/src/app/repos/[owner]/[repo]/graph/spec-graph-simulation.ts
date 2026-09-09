import * as d3 from "d3";
import { crowdedCharge, crowdedCollideRadius } from "@/lib/graph-crowding";
import { separateSmallComponents } from "@/lib/graph-layout";
import type { SimNode, SimLink } from "./spec-graph-visual";
import {
  linkDistance,
  chargeBase,
  radiusOf,
  RIM_MARGIN,
} from "./spec-graph-visual";
import { applySpacingForce } from "./spec-graph-spacing";
import type { ExpandData } from "./spec-graph-ring-layout";
import type { Point } from "./spec-graph-seed-layout";

/** Builds the force simulation: link/charge/radial-anchor/collide/spacing/rim-separation forces. State that changes after expand/collapse or drag reads through the getters below, so the forces always see the latest values. */

export interface SimulationDeps {
  degOf: (node: string | number | SimNode) => number;
  boundR: number;
  seedOf: (d: SimNode) => Point;
  getExpanded: () => Map<string, ExpandData>;
  getNodeById: () => Map<string, SimNode>;
  getRingPinned: () => Set<string>;
  smallIds: Set<string>;
  viewportCenter: Point;
}

/** Only force-placed nodes take part in separation; a pinned node (fx/fy set) is where the reader or a ring put it. */
function freePositions(nodes: SimNode[]): Array<Point & { id: string }> {
  return nodes
    .filter((n) => n.fx == null && n.fy == null)
    .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
}

/** Teleports a node and kills its velocity, so the next tick does not carry it back toward where it was pushed from. */
function placeNode(node: SimNode, p: Point): void {
  node.x = p.x;
  node.y = p.y;
  node.vx = 0;
  node.vy = 0;
}

function applySeparation(deps: SimulationDeps, nodes: SimNode[]): void {
  if (deps.smallIds.size === 0) {
    return;
  }
  const nodeById = deps.getNodeById();
  const separated = separateSmallComponents(
    freePositions(nodes),
    deps.smallIds,
    deps.viewportCenter,
    RIM_MARGIN,
  );

  for (const [id, p] of separated) {
    const node = nodeById.get(id);

    if (node) {
      placeNode(node, p);
    }
  }
}

function createSeparationForce(deps: SimulationDeps, nodes: SimNode[]) {
  return () => applySeparation(deps, nodes);
}

/** Links pull their endpoints together, with d3's standard 1/min(degree) strength: a leaf is held firmly to its parent, while a link between two hubs stays loose so neither drags the other's subtree around. */
function createLinkForce(deps: SimulationDeps) {
  return d3
    .forceLink<SimNode, SimLink>([])
    .id((d) => d.id)
    .distance((l) => linkDistance(l.kind))
    .strength(
      (l) =>
        1 / Math.max(1, Math.min(deps.degOf(l.source), deps.degOf(l.target))),
    );
}

/** Degree-scaled repulsion, softened. Capped at `boundR` so the central mass cannot fling peripheral nodes off the canvas — the seed positions and forceX/Y are what arrange the graph; this only nudges neighbours apart. */
function chargeForce(deps: SimulationDeps) {
  return d3
    .forceManyBody<SimNode>()
    .strength((d) => crowdedCharge(chargeBase(d.type), deps.degOf(d)))
    .distanceMin(12)
    .distanceMax(deps.boundR);
}

/** Collision radius grows with degree, so a well-connected node claims more room and its neighbours cannot pile on top of it. */
function collideForce(deps: SimulationDeps) {
  return d3
    .forceCollide<SimNode>((d) =>
      crowdedCollideRadius(radiusOf(d.type), deps.degOf(d)),
    )
    .strength(1);
}

/** Radial anchoring: forceX/Y pull each node back to its seeded position, which is what holds the circular shape. */
function seedXForce(deps: SimulationDeps) {
  return d3.forceX<SimNode>((d) => deps.seedOf(d).x).strength(0.22);
}

function seedYForce(deps: SimulationDeps) {
  return d3.forceY<SimNode>((d) => deps.seedOf(d).y).strength(0.22);
}

/** Spacing pass: anchors kept clear of each other & rings (resolveSpacing); others just off rings. */
function spacingForce(deps: SimulationDeps, nodes: SimNode[]) {
  return () =>
    applySpacingForce(
      nodes,
      deps.getExpanded(),
      deps.getNodeById(),
      deps.getRingPinned(),
    );
}

export interface GraphSimulation {
  sim: d3.Simulation<SimNode, undefined>;
  linkForce: d3.ForceLink<SimNode, SimLink>;
}

export function createGraphSimulation(
  nodes: SimNode[],
  deps: SimulationDeps,
): GraphSimulation {
  const linkForce = createLinkForce(deps);
  const sim = d3
    .forceSimulation<SimNode>([])
    // Heavier friction (0.7 vs d3's 0.4 default) so the forces settle instead of overshooting and oscillating.
    .velocityDecay(0.7)
    .force("link", linkForce)
    .force("charge", chargeForce(deps))
    .force("x", seedXForce(deps))
    .force("y", seedYForce(deps))
    .force("collide", collideForce(deps))
    .force("spacing", spacingForce(deps, nodes))
    // Hard separation: keep small-component nodes outside main graph, measured dynamically.
    .force("separate", createSeparationForce(deps, nodes));

  return { sim, linkForce };
}
