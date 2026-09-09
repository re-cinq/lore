/** One traversed relationship in a graph query result. */
export interface GraphHop {
  entity: string;
  relation: string;
  related_entity: string;
  direction: "outgoing" | "incoming";
  depth: number;
  valid_from?: string;
}

// `GraphRel.target` arrives as an object under `@recurse` and is normalized defensively.
function resolveRelTarget(
  rel: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const targetNode = rel["GraphRel.target"];

  return (Array.isArray(targetNode) ? targetNode[0] : targetNode) as
    Record<string, unknown> | undefined;
}

function buildHop(
  entity: Record<string, unknown>,
  rel: Record<string, unknown>,
  target: Record<string, unknown> | undefined,
  depth: number,
): GraphHop {
  return {
    entity: entity["Entity.name"] as string,
    relation: rel["GraphRel.relation_type"] as string,
    related_entity: target?.["Entity.name"] as string,
    direction: "outgoing",
    depth,
    valid_from: rel["GraphRel.valid_from"] as string | undefined,
  };
}

/** Walks a `@recurse` tree depth-first, flattening it into per-hop `GraphHop`s until `maxDepth`. */
export function flattenHops(
  entity: Record<string, unknown>,
  maxDepth: number,
  depth = 1,
): GraphHop[] {
  if (depth > maxDepth) {
    return [];
  }
  const rels = (entity["Entity.out_rels"] ?? []) as Record<string, unknown>[];
  const hops: GraphHop[] = [];

  for (const rel of rels) {
    const target = resolveRelTarget(rel);

    hops.push(buildHop(entity, rel, target, depth));

    if (target) {
      hops.push(...flattenHops(target, maxDepth, depth + 1));
    }
  }

  return hops;
}
