// GET /api/repos/{owner}/{repo}/daily-digest — the daily digest as the Loops tab shows it: the posts that went out for the repository this week, in the shared loop sections.
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import {
  capSections,
  SectionLimitsQuery,
  type SectionLimits,
} from "../loops/loop-sections.js";
import { withPool } from "../with-pool.js";
import { repoOf } from "../repos/station-helpers.js";
import { enforceRepoRow } from "../loops/loop-switch.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { DailyDigestSchema, digestQueues } from "./digest-queues.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/** A week of posts, newest first: one a day at most per scheduled time. */
const POSTS_SQL = `SELECT run_id, status, posted_at
       FROM lore.digest_posts
      WHERE repo = $1 AND posted_at > now() - interval '7 days'
      ORDER BY posted_at DESC
      LIMIT 30`;

const OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: {
      params: zodValidate(RepoParams),
      query: zodValidate(SectionLimitsQuery),
    },
  },
  DailyDigestSchema,
  {
    name: "DailyDigest",
    description:
      "The daily digest: the posts that went out for the repository this week, in the shared loop sections",
    errors: [400, 404],
  },
);

/** The run a digest post's visit belongs to: the posting station records its own visit id, and the Loops tab links the run. */
export type RunOfVisit = (visitId: string) => Promise<string | null>;

export function dailyDigestRoute(
  getPool: () => Pool | null,
  runOfVisit: RunOfVisit = floorRunOfVisit,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/daily-digest",
    options: OPTIONS,
    handler: withPool(getPool, async (pool, request, h) => {
      const repo = repoOf(request.params);

      await enforceRepoRow(pool, repo);

      return h.response(
        capSections(
          digestQueues(await postsOf(pool, repo, runOfVisit)),
          request.query as SectionLimits,
        ),
      );
    }),
  };
}

async function postsOf(pool: Pool, repo: string, runOfVisit: RunOfVisit) {
  const { rows } = await pool.query<{
    run_id: string;
    status: string;
    posted_at: Date | string;
  }>(POSTS_SQL, [repo]);

  return Promise.all(
    rows.map(async (row) => ({
      runId: await runOfVisit(row.run_id),
      status: row.status,
      postedAt: new Date(row.posted_at).toISOString(),
    })),
  );
}

/** A visit the floor no longer knows, or a floor that cannot answer, leaves the row without a run link rather than failing the read. */
async function floorRunOfVisit(visitId: string): Promise<string | null> {
  const stationRuns = floorIfConfigured()?.stationRuns;
  const visit = await stationRuns?.get(visitId).catch(() => null);

  return visit?.runId ?? null;
}
