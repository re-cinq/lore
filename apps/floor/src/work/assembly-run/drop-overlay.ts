/** Telling the graph a run is over (issue #1769): the Floor never writes Dgraph itself, so the drop rides the ingest lane the same way a test report does. */

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

/** The blueprint the ingest lane itself runs under. An ingest run must never ask for its own overlay to be dropped: that drop would start another ingest run, which would ask again, forever. */
const INGEST_BLUEPRINT = "ingest";

/** Whether closing this run should ask the graph to drop an overlay for it. */
export function shouldDropOverlay(run: {
  blueprintName: string;
  repo: string | null;
}): boolean {
  return run.blueprintName !== INGEST_BLUEPRINT && Boolean(run.repo);
}

/** The ingest event that drops the run's overlay, shaped exactly like the ci-tests hook's test-report event. */
export function dropOverlayEvent(run: AssemblyRunRecord) {
  return {
    eventName: "internal.ingest.spec_trace",
    params: {
      repo: run.repo,
      kind: "overlay-drop",
      payload: { assemblyRunId: run.id },
    },
    dedupeKey: `overlay-drop:${run.id}`,
  };
}
