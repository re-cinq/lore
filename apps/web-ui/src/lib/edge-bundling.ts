/** Hierarchical-edge-bundling geometry for D3 spec-graph (reduces hairball visualization). */

export interface KindedLink {
  source: string;
  target: string;
  kind: string;
}

/** Build child→parent map from containment links; ignore cross-cutting kinds. */
export function buildContainmentForest(
  links: KindedLink[],
  containmentKinds: Set<string>,
): Map<string, string> {
  const parent = new Map<string, string>();

  for (const { source, target, kind } of links) {
    if (containmentKinds.has(kind)) {
      parent.set(target, source);
    }
  }

  return parent;
}

/** Walk parent links from `id` to its root: [id, parent, …, root]. Cycle-safe. */
export function ancestorChain(
  parent: Map<string, string>,
  id: string,
): string[] {
  const chain = [id];
  const seen = new Set([id]);
  let current = id;

  for (;;) {
    const next = parent.get(current);

    if (next === undefined || seen.has(next)) {
      break;
    }
    chain.push(next);
    seen.add(next);
    current = next;
  }

  return chain;
}

/** Control-node ids: source up to LCA, then down to target. */
export function bundleControlIds(
  parent: Map<string, string>,
  sourceId: string,
  targetId: string,
): string[] {
  const chainSource = ancestorChain(parent, sourceId);
  const chainTarget = ancestorChain(parent, targetId);
  const targetDepth = new Map(chainTarget.map((id, index) => [id, index]));

  for (
    let sourceIndex = 0;
    sourceIndex < chainSource.length;
    sourceIndex += 1
  ) {
    const lcaTargetIndex = targetDepth.get(chainSource[sourceIndex]);

    if (lcaTargetIndex === undefined) {
      continue;
    }
    const upToLca = chainSource.slice(0, sourceIndex + 1);
    const downFromLca = chainTarget.slice(0, lcaTargetIndex).reverse();

    return [...upToLca, ...downFromLca];
  }

  return [sourceId, targetId];
}
