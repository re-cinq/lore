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

/** The radius of the largest tree, floored at 120. Trees are built at the ORIGIN first so they can be measured; the ring is then sized to fit the widest one, which is what keeps two features from overlapping. */
function widestTree(localTrees: Map<string, Point>[]): number {
  let treeRadius = 120;

  localTrees.forEach((tree) => {
    tree.forEach((point) => {
      treeRadius = Math.max(treeRadius, Math.hypot(point.x, point.y));
    });
  });

  return treeRadius;
}

/** Where one feature's tree sits. A lone feature takes the centre rather than a point on a ring of one — a single tree pushed off-centre reads as though something else were missing. */
function ringSlot(
  index: number,
  count: number,
  ringR: number,
  viewportCenter: Point,
): Point {
  if (count <= 1) {
    return viewportCenter;
  }
  const angle = (2 * Math.PI * index) / count;

  return {
    x: viewportCenter.x + ringR * Math.cos(angle),
    y: viewportCenter.y + ringR * Math.sin(angle),
  };
}

function seedFeatureTrees(
  graph: SpecGraph,
  forest: Map<string, string>,
  boundR: number,
  viewportCenter: Point,
): Map<string, Point> {
  const featureIds = graph.nodes
    .filter((n) => n.type === "Feature")
    .map((n) => n.id);
  const localTrees = featureIds.map((id) =>
    radialTree(id, buildChildrenMap(forest), {
      center: { x: 0, y: 0 },
      ringGap: RING_GAP,
    }),
  );
  const ringR = featureRingRadius(
    featureIds.length,
    widestTree(localTrees),
    boundR * FEATURE_SPREAD,
  );
  const seed = new Map<string, Point>();

  featureIds.forEach((id, index) => {
    const center = ringSlot(index, featureIds.length, ringR, viewportCenter);

    for (const [nodeId, point] of localTrees[index]) {
      seed.set(nodeId, { x: center.x + point.x, y: center.y + point.y });
    }
  });

  return seed;
}

/** Everything the feature trees did not place. A node no tree reached is spiralled near the centre; a small disconnected component is pushed to a rim OUTSIDE the main graph's extent, so it reads as separate rather than as a stray part of the whole. */
function placeStrayAndSmallComponents(
  graph: SpecGraph,
  seed: Map<string, { x: number; y: number }>,
  viewportCenter: { x: number; y: number },
): Set<string> {
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

  return smallIds;
}

/** The containment tree cross-spec edges route THROUGH, so a link between two specs bends via their shared parent rather than cutting across the canvas. Returns the forest because the seeding needs it to lay each feature out as a tree. */
function bundleThroughHierarchy(
  graph: SpecGraph,
  links: SimLink[],
): ReturnType<typeof withOwnershipForest> {
  // Bundling forest: containment tree + tree-home for each leaf so cross-spec edges route through hierarchy.
  const forest = withOwnershipForest(
    buildContainmentForest(graph.links, CONTAINMENT_KINDS),
    graph.links,
    OWNERSHIP_KINDS,
  );

  withBundleControlIds(links, forest, CONTAINMENT_KINDS);

  return forest;
}

/** Per-node degree, which the anti-crowding forces read on every tick. Computed once from the link list rather than counted per lookup — the simulation asks for this thousands of times a second. */
function degreeLookup(graph: SpecGraph) {
  const degree = nodeDegrees(graph.links);

  return (node: string | number | SimNode) => degree.get(idOf(node)) ?? 1;
}

/** Every node's starting position: one radial tree per feature, then whatever those trees did not reach. Starting positions matter more than they look — a force simulation seeded at random settles somewhere different every load, and the graph would appear to rearrange itself between visits. */
function seedPositions(
  graph: SpecGraph,
  {
    forest,
    boundR,
    viewportCenter,
  }: { forest: Map<string, string>; boundR: number; viewportCenter: Point },
) {
  const seed = seedFeatureTrees(graph, forest, boundR, viewportCenter);

  return {
    seed,
    smallIds: placeStrayAndSmallComponents(graph, seed, viewportCenter),
  };
}

export function prepareGraphLayout(
  graph: SpecGraph,
  repo: string,
  width: number,
  height: number,
): PreparedGraphLayout {
  const base = graphWorkingCopy(graph, repo);

  return { ...base, ...placeGraph(graph, base, { width, height }) };
}

/** The mutable copy the simulation runs on, plus everything derived from the graph alone. Copies, not the caller's arrays: the simulation writes x/y onto every node on every tick. */
function graphWorkingCopy(graph: SpecGraph, repo: string) {
  const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
  const links: SimLink[] = graph.links.map((l) => ({
    source: l.source,
    target: l.target,
    kind: l.kind,
  }));
  // Collapse single-owner canvas leaves into per-parent badges, applied when zoomed out.
  const { hidden: aggHidden, badges: aggBadges } = aggregateLeaves(
    graph.nodes,
    graph.links,
    LEAF_CANVAS_TYPES,
  );
  const storageKey = `lore.graph:${repo}`;

  return {
    nodes,
    links,
    degOf: degreeLookup(graph),
    forest: bundleThroughHierarchy(graph, links),
    aggHidden,
    aggBadges,
    storageKey,
    ...tryRestoreGraphState(storageKey, nodes),
  };
}

/** Where everything starts. Seeding matters more than it looks: a force simulation started at random settles somewhere different each load, so the graph would appear to rearrange itself between visits. A restored session keeps its own positions — re-seeding would discard where the reader left it. */
function placeGraph(
  graph: SpecGraph,
  base: ReturnType<typeof graphWorkingCopy>,
  { width, height }: { width: number; height: number },
) {
  const boundR = boundingRadius(graph.nodes.length, graph.links.length);
  const viewportCenter = { x: width / 2, y: height / 2 };
  const { seed, smallIds } = seedPositions(graph, {
    forest: base.forest,
    boundR,
    viewportCenter,
  });

  if (!base.restoredFromStorage) {
    seedInitialPositions(base.nodes, seed, viewportCenter);
  }

  return {
    boundR,
    viewportCenter,
    smallIds,
    seedOf: (d: SimNode) => seed.get(d.id) ?? viewportCenter,
  };
}
