/** The Utopia mirror's events: an issue or a pull request whose title, description, state or labels changed asks the tracker walk to read it again, and a published release or a created tag asks for the tags and releases (specs/utopia-graph-mirror FR14.9, FR15). */

import type { EventInsert as EventInput } from "../../events.js";
import { githubMirrorDedupeKey } from "./dedupe.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- GitHub webhook payload; shape varies by event type and is navigated defensively below
type GitHubPayload = any;

export const TRACKER_CHANGED = "github.tracker.changed";
export const RELEASE_CHANGED = "github.release.changed";

const TRACKER_ACTIONS = new Set([
  "opened",
  "edited",
  "closed",
  "reopened",
  "labeled",
  "unlabeled",
]);

const RELEASE_ACTIONS = new Set(["published", "edited"]);

/** Which mirror event, if any, a delivery of this type asks for. */
const MIRROR_EVENT_OF: Record<
  string,
  ((payload: GitHubPayload) => string | null) | undefined
> = {
  issues: trackerAction,
  pull_request: trackerAction,
  release: (payload) =>
    RELEASE_ACTIONS.has(payload?.action) ? RELEASE_CHANGED : null,
  create: (payload) => (payload?.ref_type === "tag" ? RELEASE_CHANGED : null),
};

/** Keyed apart from the delivery's own event, which the same delivery id already keys. */
export function mirrorEvents(
  eventType: string,
  payload: GitHubPayload,
  repo: string,
  deliveryId: string,
): EventInput[] {
  const eventName = MIRROR_EVENT_OF[eventType]?.(payload) ?? null;

  return eventName
    ? [
        {
          eventName,
          source: "github",
          params: { repo },
          dedupeKey: githubMirrorDedupeKey(deliveryId),
        },
      ]
    : [];
}

function trackerAction(payload: GitHubPayload): string | null {
  return TRACKER_ACTIONS.has(payload?.action) ? TRACKER_CHANGED : null;
}
