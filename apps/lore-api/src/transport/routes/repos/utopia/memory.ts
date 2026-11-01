import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { UtopiaMemorySummarySchema } from "@re-cinq/lore-shared/utopia/memory-summary.js";
import { zodResponse } from "../../../http/zod-response.js";
import { bearerScope } from "../../../http/bearer-scope.js";
import { withPool } from "../../with-pool.js";
import {
  memoryWalkDepsFor,
  mirrorMemoryBacklog,
} from "../../../../work/utopia/memory/utopia-memory.js";
import { orgMemoryBase } from "../../../../work/utopia/memory/utopia-memory-base.js";
import { utopiaWalkRoute } from "./walk-route.js";
import { enforceUtopiaConfigured } from "./setup.js";

const DESCRIPTION =
  "Each walk's cursor before and after, Utopia's created/updated/unchanged document counts, and the memory or episode the walk stopped at";

/** POST /api/repos/{owner}/{repo}/utopia/memory — the repo's memories and episodes above their cursors, mirrored into its Utopia knowledge base (specs/utopia-graph-mirror FR16). */
export function utopiaMemoryRoute(getPool: () => Pool | null): ServerRoute {
  return utopiaWalkRoute(getPool, {
    segment: "memory",
    schema: UtopiaMemorySummarySchema,
    name: "UtopiaMemorySummary",
    description: DESCRIPTION,
    walk: (deps) => mirrorMemoryBacklog(deps.memory),
  });
}

/** POST /api/utopia/memory — the memories and episodes no onboarded repo owns, mirrored into the org's `<org>/memory` knowledge base: 503 without a Utopia, 409 on a deployment that names no org. */
export function utopiaOrgMemoryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/utopia/memory",
    options: zodResponse(bearerScope("admin"), UtopiaMemorySummarySchema, {
      name: "UtopiaOrgMemorySummary",
      description: DESCRIPTION,
      errors: [409],
    }),
    handler: withPool(getPool, async (pool, _request, h) =>
      h.response(await mirrorMemoryBacklog(orgMemoryWalk(pool))),
    ),
  };
}

function orgMemoryWalk(pool: Pool) {
  enforceUtopiaConfigured();
  const base = orgMemoryBase();

  enforceTrue(
    base,
    apiError(409, { code: "utopia_org_not_named" }),
    "GITHUB_ORG is unset on this deployment, so it has no org memory base",
  );

  return memoryWalkDepsFor(pool, base!);
}
