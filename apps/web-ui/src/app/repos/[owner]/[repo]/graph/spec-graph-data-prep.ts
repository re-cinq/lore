import type { SpecGraph } from "@/lib/spec-graph";
import { nodeDegrees } from "@/lib/graph-crowding";
import {
  boundingRadius,
  connectedComponents,
  rimTargets,
  radialTree,
  featureRingRadius,
} from "@/lib/graph-layout";
import { aggregateLeaves } from "@/lib/graph-aggregation";
import { buildContainmentForest } from "@/lib/edge-bundling";
import {
  idOf,
  LEAF_CANVAS_TYPES,
  CONTAINMENT_KINDS,
  OWNERSHIP_KINDS,
  RING_GAP,
  FEATURE_SPREAD,
  RIM_MARGIN,
  SMALL_COMPONENT_MAX,
  type SimNode,
  type SimLink,
} from "./spec-graph-visual";
import {
  withOwnershipForest,
  withBundleControlIds,
  tryRestoreGraphState,
  buildChildrenMap,
  seedStrayNodes,
  computeMainExtent,
  applyRimTargets,
  seedInitialPositions,
  type Point,
} from "./spec-graph-seed-layout";

/** Everything computed once before the simulation starts: node/link copies, the bundling forest, the radial-tree seed layout, and any restored session state. */

export interface PreparedGraphLayout {
  nodes: SimNode[];
  links: SimLink[];
  degOf: (node: string | number | SimNode) => number;
  forest: Map<string, string>;
  aggHidden: Set<string>;
  aggBadges: { parentId: string; type: SimNode["type"]; count: number }[];
  boundR: number;
  viewportCenter: Point;
  seedOf: (d: SimNode) => Point;
  smallIds: Set<string>;
  storageKey: string;
  savedExpanded: string[];
  restoredFromStorage: boolean;
}

function seedFeatureTrees(
  graph: SpecGraph,
  forest: Map<string, string>,
  boundR: number,
  viewportCenter: Point,
): Map<string, Point> {
  const childrenOf = buildChildrenMap(forest);
  const featureIds = graph.nodes
    .filter((n) => n.type === "Feature")
    .map((n) => n.id);
  // Build each feature tree at origin to measure radius, then place on ring to prevent overlap.
  const localTrees = featureIds.map((id) =>
    radialTree(id, childrenOf, { center: { x: 0, y: 0 }, ringGap: RING_GAP }),
  );
  let treeRadius = 120;

  localTrees.forEach((tree) => {
    tree.forEach((p) => {
      treeRadius = Math.max(treeRadius, Math.hypot(p.x, p.y));
    });
  });
  const ringR = featureRingRadius(
    featureIds.length,
    treeRadius,
    boundR * FEATURE_SPREAD,
  );
  const seed = new Map<string, Point>();

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

  return seed;
}

export function prepareGraphLayout(
  graph: SpecGraph,
  repo: string,
  width: number,
  height: number,
): PreparedGraphLayout {
  const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
  const links: SimLink[] = graph.links.map((l) => ({
    source: l.source,
    target: l.target,
    kind: l.kind,
  }));
  // Per-node degree feeds anti-crowding rules in force setup; computed once from link list.
  const degree = nodeDegrees(graph.links);
  const degOf = (node: string | number | SimNode) =>
    degree.get(idOf(node)) ?? 1;

  // Aggregation: collapse single-owner canvas leaves into per-parent badges (applied when zoomed out).
  const { hidden: aggHidden, badges: aggBadges } = aggregateLeaves(
    graph.nodes,
    graph.links,
    LEAF_CANVAS_TYPES,
  );

  // Bundling forest: containment tree + tree-home for each leaf so cross-spec edges route through hierarchy.
  const forest = withOwnershipForest(
    buildContainmentForest(graph.links, CONTAINMENT_KINDS),
    graph.links,
    OWNERSHIP_KINDS,
  );

  withBundleControlIds(links, forest, CONTAINMENT_KINDS);

  const storageKey = `lore.graph:${repo}`;
  const { savedExpanded, restoredFromStorage } = tryRestoreGraphState(
    storageKey,
    nodes,
  );

  // Radial-tree-per-feature layout: invert forest into children lists, ring small components outside.
  const boundR = boundingRadius(graph.nodes.length, graph.links.length);
  const viewportCenter = { x: width / 2, y: height / 2 };
  const seed = seedFeatureTrees(graph, forest, boundR, viewportCenter);

  // Unreached nodes: seed as spiral near center with LOCAL counter to bound radius.
  const components = connectedComponents(
    graph.nodes.map((n) => n.id),
    graph.links,
  );
  const smallComponents = components.filter(
    (c) => c.length < SMALL_COMPONENT_MAX && !c.some((id) => seed.has(id)),
  );
  const smallIds = new Set(smallComponents.flat());

  seedStrayNodes(graph.nodes, seed, smallIds, viewportCenter);

  // Add small components last on rim beyond main graph extent, so they ring the outside.
  const mainExtent = computeMainExtent(seed, viewportCenter);

  applyRimTargets(
    seed,
    rimTargets(smallComponents, viewportCenter, mainExtent + RIM_MARGIN),
  );

  const seedOf = (d: SimNode) => seed.get(d.id) ?? viewportCenter;

  if (!restoredFromStorage) {
    seedInitialPositions(nodes, seed, viewportCenter);
  }

  return {
    nodes,
    links,
    degOf,
    forest,
    aggHidden,
    aggBadges,
    boundR,
    viewportCenter,
    seedOf,
    smallIds,
    storageKey,
    savedExpanded,
    restoredFromStorage,
  };
}
