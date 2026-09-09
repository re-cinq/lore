// The one rule for resolving the graph a run walks (FR6.38): the run's OWN clone decides (a blueprint edit must not reroute an in-flight run), loading by name is only the fallback for rows stamped before clones existed (DELETE once no open run lacks a graph), and undefined means a single-CR run record (FR6.8, agent-watcher owns its lifecycle). Previously three hand-copies (advance, node-event handler, reaper) plus a reader that skipped it — walk vs reap could resolve different graphs for the same run.

import { snapshotGraph } from "./snapshot-graph.js";
import type { AssemblyLine } from "./loader.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

// The catalog loads only on the fallback path — a row carrying its clone never pays for it (the loader is memoized, but even the await is skipped).
export async function resolveRunGraph(
  row: Pick<AssemblyRunRecord, "graph" | "blueprintName">,
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>,
): Promise<RunGraph | undefined> {
  if (row.graph) {
    return row.graph;
  }
  const definition = (await definitions()).get(row.blueprintName);

  return definition ? snapshotGraph(definition, row.blueprintName) : undefined;
}
