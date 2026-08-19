// The one rule for resolving the graph a run walks (FR6.38).
//
// The run's OWN clone decides: editing a blueprint must not change the route of a
// run already in flight, and a run whose blueprint was renamed or deleted must
// still finish. A blueprint loaded by name is only the fallback for rows stamped
// before clones existed — DELETE the fallback once no open run lacks a graph.
// Undefined means a single-CR run record (FR6.8): no graph, no walk — the
// agent-watcher owns its lifecycle.
//
// This rule used to live in three hand-copies (advance, the node-event handler,
// the reaper) plus one reader that skipped it altogether; a fix applied to one
// copy would miss the others, and walk vs reap would resolve different graphs
// for the same run.

import { snapshotGraph, type AssemblyLine } from "./index.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

/** The catalog loads only on the fallback path — a row carrying its clone never
 *  pays for it (the loader is memoized, but even the await is skipped). */
export async function graphForRun(
  row: Pick<AssemblyRunRecord, "graph" | "blueprintName">,
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>,
): Promise<RunGraph | undefined> {
  if (row.graph) {
    return row.graph;
  }
  const definition = (await definitions()).get(row.blueprintName);

  return definition ? snapshotGraph(definition, row.blueprintName) : undefined;
}
