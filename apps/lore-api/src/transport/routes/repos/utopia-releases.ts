import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { UtopiaReleasesSummarySchema } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { mirrorReleases } from "../../../work/utopia/github/utopia-releases.js";
import { utopiaWalkRoute } from "./utopia-walk-route.js";

/** POST /api/repos/{owner}/{repo}/utopia/releases — the repo's tags and published releases, mirrored into its Utopia knowledge base (specs/utopia-graph-mirror FR15). */
export function utopiaReleasesRoute(getPool: () => Pool | null): ServerRoute {
  return utopiaWalkRoute(getPool, {
    segment: "releases",
    schema: UtopiaReleasesSummarySchema,
    name: "UtopiaReleasesSummary",
    description:
      "How many tags and published releases were read, Utopia's created/updated/unchanged item counts, and every item it refused",
    walk: (deps) => mirrorReleases(deps.releases),
  });
}
