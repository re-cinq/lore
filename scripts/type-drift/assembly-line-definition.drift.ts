/**
 * Compile-time drift guard for the assembly-line definition mirror.
 *
 * apps/web-ui cannot import libs/assembly-lines (npm-workspace exclusion +
 * isolated Docker build context), so the loader's zod-inferred definition types
 * are hand-mirrored in apps/web-ui/src/lib/assembly-line-definition.ts. This
 * file makes `npm run typecheck:drift` go red the moment the loader's schema
 * gains a field, or either closed union gains a member, that the mirror lacks.
 *
 * Keys-only on the object types, exact on the unions: the mirror declares
 * `version: 1` where the canonical type is the same literal, but optional
 * modifiers and zod's inference details are not worth asserting structurally.
 */

import type {
  AssemblyLineNode as CanonNode,
  AssemblyLineEdge as CanonEdge,
  AssemblyLine as CanonLine,
  EdgeConditionValue as CanonEdgeCondition,
} from "../../libs/assembly-lines/src/loader.js";

import type {
  DefinitionNode as MirrorNode,
  DefinitionEdge as MirrorEdge,
  AssemblyLineDefinition as MirrorLine,
  DefinitionEdgeCondition as MirrorEdgeCondition,
  DefinitionNodeType as MirrorNodeType,
} from "../../apps/web-ui/src/lib/assembly-line-definition.js";

type KeysCovered<Canon, Mirror> = keyof Canon extends keyof Mirror
  ? true
  : { MIRROR_MISSING_KEYS: Exclude<keyof Canon, keyof Mirror> };

type UnionEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { UNION_MIRROR_HAS_EXTRA: Exclude<B, A> }
  : { UNION_MIRROR_IS_MISSING: Exclude<A, B> };

export const _node: KeysCovered<CanonNode, MirrorNode> = true;
export const _edge: KeysCovered<CanonEdge, MirrorEdge> = true;
export const _line: KeysCovered<CanonLine, MirrorLine> = true;

export const _edgeCondition: UnionEqual<
  CanonEdgeCondition,
  MirrorEdgeCondition
> = true;
export const _nodeType: UnionEqual<CanonNode["type"], MirrorNodeType> = true;
