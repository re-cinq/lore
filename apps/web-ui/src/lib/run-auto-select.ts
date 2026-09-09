// Which node the inspector opens on before anyone clicks (run-viz FR4.14): the node being worked, else the one that failed, else the one that finished last. A click is sticky for as long as it names a node the graph still has.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-run-rows";
import type { NodeRunState } from "./run-event-reducer";

// A node id the definition names may have no state yet, so the index is honest about the hole.
type NodeStates = Readonly<Record<string, NodeRunState | undefined>>;

/** Definition order, then any node the stream knows that the definition does not. */
function nodeOrder(
  definition: AssemblyLineDefinition | null,
  nodeStates: NodeStates,
): string[] {
  const declared = (definition?.nodes ?? []).map((node) => node.id);
  const extra = Object.keys(nodeStates).filter((id) => !declared.includes(id));

  return [...declared, ...extra];
}

function firstWithStatus(
  order: readonly string[],
  nodeStates: NodeStates,
  status: NodeRunState["status"],
): string | null {
  return order.find((id) => nodeStates[id]?.status === status) ?? null;
}

/** The finished node whose visit began last; a tie or a row without a start falls back to definition order. */
function lastFinished(
  order: readonly string[],
  nodeStates: NodeStates,
  latestRows: ReadonlyMap<string, AssemblyRunNode>,
): string | null {
  const finished = order.filter((id) => nodeStates[id]?.status === "succeeded");
  const startOf = (id: string) =>
    Date.parse(latestRows.get(id)?.startedAt ?? "") || 0;

  return finished.reduce<string | null>(
    (best, id) => (best !== null && startOf(best) >= startOf(id) ? best : id),
    null,
  );
}

export function autoSelectNodeId(
  definition: AssemblyLineDefinition | null,
  nodeStates: NodeStates,
  latestRows: ReadonlyMap<string, AssemblyRunNode>,
): string | null {
  const order = nodeOrder(definition, nodeStates);

  return (
    firstWithStatus(order, nodeStates, "running") ??
    firstWithStatus(order, nodeStates, "failed") ??
    lastFinished(order, nodeStates, latestRows)
  );
}

/** The user's pick wins while it names a node the graph has; otherwise the automatic choice. */
export function effectiveSelection(
  userPick: string | null,
  auto: string | null,
  knownIds: ReadonlySet<string>,
): string | null {
  return userPick !== null && knownIds.has(userPick) ? userPick : auto;
}
