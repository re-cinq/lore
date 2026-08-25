/**
 * Who writes the run's episode — the line, or the Floor closing it.
 *
 * `finishLine` writes one episode per run because for most lines nothing else
 * does: their only `retrospective` node is the `done` exit marker, and the walk
 * finishes AT the exit rather than dispatching it.
 *
 * Three lines (general, gap-fill, implementation) also carry a retrospective
 * node mid-graph. That node now executes for real as a service station, so those
 * runs would get two episodes for one run. The mid-line node is the one that
 * owns the write — it has the node's own context — so the Floor stands down.
 */

import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

export function lineWritesOwnEpisode(graph: RunGraph | null): boolean {
  return (graph?.nodes ?? []).some(
    (node) => node.type === "retrospective" && node.id !== graph?.exit,
  );
}
