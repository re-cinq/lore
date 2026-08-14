/**
 * Compile-time drift guard for the run-graph mirror.
 *
 * apps/web-ui cannot import @re-cinq/lore-shared (npm-workspace exclusion +
 * isolated Docker build context), so the persisted RunGraph wire format is
 * hand-mirrored in apps/web-ui/src/lib/run-graph.ts. This file makes
 * `npm run typecheck:drift` go red the moment either side changes shape.
 *
 * Exact both ways, not keys-only: unlike the loader mirror (zod inference
 * quirks), both sides here are plain interfaces describing the same stored
 * jsonb — an optionality mismatch is real drift (the mirror shipped with
 * `station_inherited?` where the clone always records it).
 */

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

type MirrorsExactly<Canon, Mirror> = [Canon] extends [Mirror]
  ? [Mirror] extends [Canon]
    ? true
    : { MIRROR_IS_WIDER_THAN_CANON: Mirror }
  : { MIRROR_REJECTS_CANON: Canon };

export const _node: MirrorsExactly<CanonNode, MirrorNode> = true;
export const _edge: MirrorsExactly<CanonEdge, MirrorEdge> = true;
export const _graph: MirrorsExactly<CanonGraph, MirrorGraph> = true;
