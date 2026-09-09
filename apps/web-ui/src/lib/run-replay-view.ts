// The newest walk row per node — the verdict source the graph and inspector read (walk rows stay authoritative, not event.isError).

import type { AssemblyRunNode } from "./assembly-runs";

/** Newest walk row per node; max iteration wins regardless of ORDER BY. */
export function latestRowByNode(
  rows: readonly AssemblyRunNode[],
): Map<string, AssemblyRunNode> {
  const latest = new Map<string, AssemblyRunNode>();

  for (const row of rows) {
    const prev = latest.get(row.nodeId);

    if (!prev || row.iteration >= prev.iteration) {
      latest.set(row.nodeId, row);
    }
  }

  return latest;
}
