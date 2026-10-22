import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { UtopiaTrackerSummarySchema } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { mirrorTracker } from "../../../work/utopia/github/utopia-tracker.js";
import { utopiaWalkRoute } from "./utopia-walk-route.js";

/** POST /api/repos/{owner}/{repo}/utopia/tracker — the issues and pull requests GitHub updated since the stored cursor, mirrored into the repo's Utopia knowledge base (specs/utopia-graph-mirror FR14). */
export function utopiaTrackerRoute(getPool: () => Pool | null): ServerRoute {
  return utopiaWalkRoute(getPool, {
    segment: "tracker",
    schema: UtopiaTrackerSummarySchema,
    name: "UtopiaTrackerSummary",
    description:
      "The update time the walk asked from, the newest one pushed, Utopia's created/updated/unchanged item counts, and the issue or pull request the walk stopped at",
    walk: (deps) => mirrorTracker(deps.tracker),
  });
}
