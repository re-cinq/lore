// Who writes the run's episode — the line, or the Floor closing it: `finishLine` writes one by default (most lines' only `retrospective` node is the `done` exit marker), but the three lines with a mid-graph retrospective node own the write themselves, else a run gets two episodes.

import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

export function lineWritesOwnEpisode(graph: RunGraph | null): boolean {
  return (graph?.nodes ?? []).some(
    (node) => node.type === "retrospective" && node.id !== graph?.exit,
  );
}
