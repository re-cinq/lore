import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { utopiaSetupRoute } from "./utopia-setup.js";
import { utopiaBackfillRoute } from "./utopia-backfill.js";
import { utopiaCommitsRoute } from "./utopia-commits.js";

/** The repo's Utopia knowledge base: set it up, fill it with what was ingested before the mirror, and walk its commits (specs/utopia-graph-mirror). */
export function utopiaRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    utopiaSetupRoute(getPool),
    utopiaBackfillRoute(getPool),
    utopiaCommitsRoute(getPool),
  ];
}
