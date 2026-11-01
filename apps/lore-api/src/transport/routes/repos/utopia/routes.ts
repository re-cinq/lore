import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { utopiaSetupRoute } from "./setup.js";
import { utopiaBackfillRoute } from "./backfill.js";
import { utopiaCommitsRoute } from "./commits.js";
import { utopiaTrackerRoute } from "./tracker.js";
import { utopiaReleasesRoute } from "./releases.js";
import { utopiaResetRoute } from "./reset.js";
import { utopiaMemoryRoute, utopiaOrgMemoryRoute } from "./memory.js";

/** The repo's Utopia knowledge base: set it up, fill it with what was ingested before the mirror, and walk its commits, issues, pull requests, tags, releases, memories and episodes (specs/utopia-graph-mirror). */
export function utopiaRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    utopiaSetupRoute(getPool),
    utopiaBackfillRoute(getPool),
    utopiaCommitsRoute(getPool),
    utopiaTrackerRoute(getPool),
    utopiaReleasesRoute(getPool),
    utopiaResetRoute(getPool),
    utopiaMemoryRoute(getPool),
    utopiaOrgMemoryRoute(getPool),
  ];
}
