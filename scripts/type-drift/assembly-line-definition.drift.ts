// Drift guard: web-ui can't import libs/assembly-lines (npm-workspace exclusion), so its definition types are hand-mirrored; keys-only on objects, exact on unions.

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
