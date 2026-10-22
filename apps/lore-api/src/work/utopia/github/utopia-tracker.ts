// Mirrors a repo's issues and pull requests into its Utopia knowledge base: what GitHub updated since the cursor its settings hold, oldest update first, each pushed and the cursor moved to its update time, so a walk that stops leaves the next one where it was.

import type { TrackerActivityOptions } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { TrackedEntry } from "@re-cinq/lore-shared/utopia/tracker-statements.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import type { UtopiaTrackerSummary } from "@re-cinq/lore-shared/utopia/tracker-summary.js";
import { mirrorTrackedEntry } from "@re-cinq/lore-shared/utopia/mirror-tracker.js";
import { saveUtopiaTrackerSince } from "../../../outbound/utopia-sources.js";
import { storedCursor, type WalkSource } from "../walk-source.js";
import { queuedPerRepo, walkInOrder } from "../cursor-walk.js";

export interface TrackerDeps {
  repo: string;
  tracker: {
    trackerActivity(opts: TrackerActivityOptions): Promise<TrackedEntry[]>;
  };
  cursor: {
    read(): Promise<string | null>;
    write(since: string): Promise<void>;
  };
  mirror(entry: TrackedEntry): Promise<MirrorOutcome>;
}

/** One walk pushes this many entries at most: each is a job Utopia's database must work through, and a 2,000-entry first walk timed out against a database already at its CPU limit (2026-10-17). A longer backlog takes more walks, each resuming from the cursor, one per changed issue or pull request and one per weekly backfill. */
export const MAX_TRACKED_PER_RUN = 200;

export function mirrorTracker(
  deps: TrackerDeps,
): Promise<UtopiaTrackerSummary> {
  return queuedPerRepo(deps.repo, () => walkTracker(deps));
}

/** GitHub's `since` includes the cursor's own second, so the entry the last walk ended on comes back and answers unchanged. */
async function walkTracker(deps: TrackerDeps): Promise<UtopiaTrackerSummary> {
  const from = await deps.cursor.read();
  const activity = await deps.tracker.trackerActivity({
    ...(from === null ? {} : { since: from }),
    limit: MAX_TRACKED_PER_RUN,
  });
  const { landed, ...tally } = await walkInOrder(activity, {
    cursorOf: (entry) => entry.updatedAt,
    labelOf: (entry) => `${entry.kind}:${entry.number}`,
    mirror: (entry) => deps.mirror(entry),
    writeCursor: (since) => deps.cursor.write(since),
  });

  return { from, ...tally, entries: landed };
}

export function trackerDepsFor(
  source: WalkSource<TrackerDeps["tracker"]>,
): TrackerDeps {
  const { pool, repo, mirror } = source;

  return {
    repo,
    tracker: source.files,
    cursor: {
      read: () => storedCursor(source, "tracker_since"),
      write: (since) => saveUtopiaTrackerSince(pool, repo, since),
    },
    mirror: (entry) => mirrorTrackedEntry(mirror, repo, entry),
  };
}
