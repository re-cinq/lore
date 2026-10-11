// Drift guard: web-ui can't import @re-cinq/lore-shared, so RunGraph is hand-mirrored in web-ui/src/lib/run-graph.ts; exact both ways since both sides are plain interfaces.

import type {
  RunGraphNode as CanonNode,
  RunGraphEdge as CanonEdge,
  RunGraph as CanonGraph,
} from "../../libs/shared/src/domain/run-graph.js";

import type {
  RunGraphNode as MirrorNode,
  RunGraphEdge as MirrorEdge,
  RunGraph as MirrorGraph,
} from "../../apps/web-ui/src/lib/run-graph.js";

type MirrorsExactly<Canon, Mirror> = [Canon] extends [Mirror]
  ? [Mirror] extends [Canon]
    ? true
    : { MIRROR_IS_WIDER_THAN_CANON: Mirror }
  : { MIRROR_REJECTS_CANON: Canon };

export const _node: MirrorsExactly<CanonNode, MirrorNode> = true;
export const _edge: MirrorsExactly<CanonEdge, MirrorEdge> = true;
export const _graph: MirrorsExactly<CanonGraph, MirrorGraph> = true;
