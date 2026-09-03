// Drift guard: web-ui can't import @re-cinq/lore-shared, so RunGraph is hand-mirrored in web-ui/src/lib/run-graph.ts; exact both ways since both sides are plain interfaces.

import type {
  RunGraphNode as CanonNode,
  RunGraphEdge as CanonEdge,
  RunGraph as CanonGraph,
} from "../../libs/shared/src/project/assembly-runs/run-graph.js";

import type {
  RunGraphNode as MirrorNode,
  RunGraphEdge as MirrorEdge,
  RunGraph as MirrorGraph,
} from "../../apps/web-ui/src/lib/run-graph.js";

import type { HumanStationType as CanonHumanStationType } from "../../libs/assembly-lines/src/human-station.js";
import type { HumanStationType as MirrorHumanStationType } from "../../apps/web-ui/src/lib/human-station.js";

type MirrorsExactly<Canon, Mirror> = [Canon] extends [Mirror]
  ? [Mirror] extends [Canon]
    ? true
    : { MIRROR_IS_WIDER_THAN_CANON: Mirror }
  : { MIRROR_REJECTS_CANON: Canon };

export const _node: MirrorsExactly<CanonNode, MirrorNode> = true;
export const _edge: MirrorsExactly<CanonEdge, MirrorEdge> = true;
export const _graph: MirrorsExactly<CanonGraph, MirrorGraph> = true;

// web-ui's HUMAN_STATIONS record is keyed on this union, so a libs-side addition goes red here until the record answers for it.
export const _humanStationType: MirrorsExactly<
  CanonHumanStationType,
  MirrorHumanStationType
> = true;
