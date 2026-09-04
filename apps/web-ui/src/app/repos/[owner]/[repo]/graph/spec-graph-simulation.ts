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

function createSeparationForce(deps: SimulationDeps, nodes: SimNode[]) {
  return () => {
    if (deps.smallIds.size === 0) {
      return;
    }
    const nodeById = deps.getNodeById();
    const placed = nodes
      .filter((n) => n.fx == null && n.fy == null)
      .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));

    for (const [id, p] of separateSmallComponents(
      placed,
      deps.smallIds,
      deps.viewportCenter,
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
  };
}

export function createGraphSimulation(
  nodes: SimNode[],
  deps: SimulationDeps,
): {
  sim: d3.Simulation<SimNode, undefined>;
  linkForce: d3.ForceLink<SimNode, SimLink>;
} {
  const linkForce = d3
    .forceLink<SimNode, SimLink>([])
    .id((d) => d.id)
    .distance((l) => linkDistance(l.kind))
    // d3's standard 1/min(degree): leaves held firm, hub-hub links loose.
    .strength(
      (l) =>
        1 / Math.max(1, Math.min(deps.degOf(l.source), deps.degOf(l.target))),
    );
  const sim = d3
    .forceSimulation<SimNode>([])
    // Heavier friction (0.7 vs 0.4 default) so forces settle without overshooting.
    .velocityDecay(0.7)
    .force("link", linkForce)
    // Degree-scaled repulsion (softened): nudges neighbors apart; seed/forceX/Y arrange graph.
    .force(
      "charge",
      d3
        .forceManyBody<SimNode>()
        .strength((d) => crowdedCharge(chargeBase(d.type), deps.degOf(d)))
        .distanceMin(12)
        // Localize repulsion to bound's range so central mass doesn't fling peripheral nodes.
        .distanceMax(deps.boundR),
    )
    // Radial anchoring: forceX/Y pull each node to seeded position, hold circular shape.
    .force("x", d3.forceX<SimNode>((d) => deps.seedOf(d).x).strength(0.22))
    .force("y", d3.forceY<SimNode>((d) => deps.seedOf(d).y).strength(0.22))
    // Anti-crowding rule #3: degree-scaled collision radius prevents piling.
    .force(
      "collide",
      d3
        .forceCollide<SimNode>((d) =>
          crowdedCollideRadius(radiusOf(d.type), deps.degOf(d)),
        )
        .strength(1),
    )
    // Spacing pass: anchors kept clear of each other & rings (resolveSpacing); others just off rings.
    .force("spacing", () =>
      applySpacingForce(
        nodes,
        deps.getExpanded(),
        deps.getNodeById(),
        deps.getRingPinned(),
      ),
    )
    // Hard separation: keep small-component nodes outside main graph, measured dynamically.
    .force("separate", createSeparationForce(deps, nodes));

  return { sim, linkForce };
}
