/** Telling the graph a branch is done (issue #1769): its PR closed, merged or not, so the overlay its pushes built describes nothing anyone will read again. Keyed on the PR, not on a run — every run on a PR's head branch (implementation, review, triage, reply) shares one overlay, so no single run's end may drop it. The Floor never writes Dgraph itself, so the drop rides the ingest lane the same way a test report does. */

import type { EventHandler, EventInput } from "../../domain/event-types.js";
import { eventReporter } from "../../outbound/queues.js";

/** The ingest event that drops a closed PR's head-branch overlay, or null when the PR names no head branch. The drop is idempotent, so a redelivered close needs no dedupe key — and a key would swallow the drop for a branch name a later PR reuses. */
function dropOverlayEvent(params: Record<string, unknown>): EventInput | null {
  const { repo, branch } = params as { repo?: string; branch?: string };

  if (!repo || !branch) {
    return null;
  }

  return {
    eventName: "internal.ingest.spec_trace",
    source: "internal",
    params: { repo, kind: "overlay-drop", payload: { overlayBranch: branch } },
  };
}

export function createDropOverlayOnClose(
  insert: (event: EventInput) => Promise<unknown>,
): EventHandler {
  return async (params) => {
    const event = dropOverlayEvent(params);

    if (event) {
      await insert(event);
    }
  };
}

export const dropOverlayOnClose = createDropOverlayOnClose((event) =>
  eventReporter().insert(event),
);
