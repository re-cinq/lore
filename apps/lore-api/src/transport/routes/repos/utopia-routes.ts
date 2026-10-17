import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { utopiaSetupRoute } from "./utopia-setup.js";
import { utopiaBackfillRoute } from "./utopia-backfill.js";
import { utopiaCommitsRoute } from "./utopia-commits.js";
import { utopiaTrackerRoute } from "./utopia-tracker.js";
import { utopiaReleasesRoute } from "./utopia-releases.js";

/** The repo's Utopia knowledge base: set it up, fill it with what was ingested before the mirror, and walk its commits, issues, pull requests, tags and releases (specs/utopia-graph-mirror). */
export function utopiaRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    utopiaSetupRoute(getPool),
    utopiaBackfillRoute(getPool),
    utopiaCommitsRoute(getPool),
    utopiaTrackerRoute(getPool),
    utopiaReleasesRoute(getPool),
  ];
}
