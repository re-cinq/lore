import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { withPool } from "../with-pool.js";
import { clearUtopiaCursors } from "../../../outbound/utopia-sources.js";
import { clearStoredCommits } from "../ingest/ingest-delta-state.js";
import { enforceRepoHeld, enforceUtopiaConfigured } from "./utopia-setup.js";

const UtopiaResetSummarySchema = z.object({
  /** How many stored ingest commits were forgotten: the `code` and `test-report` kinds the CI delta refills `test-coverage` from. */
  ingest_state_cleared: z.number(),
});

/** The delta kinds whose items live in the `test-coverage` source and reach it only when a delta carries them. */
const TEST_COVERAGE_KINDS = ["code", "test-report"];

/** POST /api/repos/{owner}/{repo}/utopia/reset — start the repo's Utopia mirror over: the commit and tracker walks go back to the beginning and the next CI run sends every test and source file again (specs/utopia-graph-mirror FR19). */
export function utopiaResetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/utopia/reset",
    options: zodResponse(bearerScope("admin"), UtopiaResetSummarySchema, {
      name: "UtopiaResetSummary",
      description:
        "How many stored ingest commits were forgotten so the next test and code deltas carry everything",
      errors: [404],
    }),
    handler: withPool(getPool, async (pool, request, h) =>
      h.response(
        await resetRepo(pool, `${request.params.owner}/${request.params.repo}`),
      ),
    ),
  };
}

async function resetRepo(
  pool: Pool,
  repo: string,
): Promise<{ ingest_state_cleared: number }> {
  enforceUtopiaConfigured();
  await enforceRepoHeld(pool, repo);
  await clearUtopiaCursors(pool, repo);

  return {
    ingest_state_cleared: await clearStoredCommits(
      pool,
      repo,
      TEST_COVERAGE_KINDS,
    ),
  };
}
