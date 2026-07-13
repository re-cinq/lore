/**
 * Pure hierarchical-edge-bundling geometry for the D3 spec-graph.
 *
 * Cross-cutting edges (validated_by / implemented_by / covers / decided_by) drawn
 * as straight chords turn a dense graph into a hairball. Bundling routes an edge
 * along the containment tree (Feature ⊃ Spec ⊃ Statement/AcceptanceCriterion):
 * up from the source to the lowest common ancestor, then back down to the target.
 * Edges that share a subtree visually converge, exposing flow instead of noise.
 *
 * These helpers return render-agnostic control-node id *sequences*; the shell
 * resolves them to live positions per tick and smooths them with a spline. No
 * side effects.
 */

export interface KindedLink {
  source: string;
  target: string;
  kind: string;
}

/**
 * Builds the child→parent map from containment links only (parent = source).
 * Cross-cutting kinds are ignored, so leaf artefacts stay out of the tree.
 */
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

/**
 * Control-node ids for bundling the edge source→target: source up to the lowest
 * common ancestor, then down to target. Falls back to a straight [source, target]
 * when the two share no ancestor (e.g. a leaf with no tree home).
 */
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
    const upToLca = chainSource.slice(0, sourceIndex + 1); // source … LCA
    const downFromLca = chainTarget.slice(0, lcaTargetIndex).reverse(); // child-of-LCA … target

    return [...upToLca, ...downFromLca];
  }

  return [sourceId, targetId];
}
