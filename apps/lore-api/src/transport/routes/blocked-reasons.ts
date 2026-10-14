import type { Pool } from "pg";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../http/zod-response.js";
import { bearerScope } from "../http/bearer-scope.js";
import { zodValidate } from "../http/zod-validate.js";
import { errorMessage } from "@re-cinq/lore-shared";

const PrParam = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.coerce.number(),
});

const RepoParam = z.object({
  owner: z.string(),
  repo: z.string(),
});

const BlockedReasonSchema = z.object({
  repo: z.string(),
  prNumber: z.number(),
  reason: z.string().nullable(),
  label: z.string().nullable(),
  detail: z.string().nullable(),
  since: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const BlockedPullsSchema = z.object({
  pulls: z.array(BlockedReasonSchema),
});

type BlockedReason = z.infer<typeof BlockedReasonSchema>;

const reasonRouteOpts = zodResponse(
  { ...bearerScope("read"), validate: { params: zodValidate(PrParam) } },
  BlockedReasonSchema,
  {
    name: "BlockedReason",
    description: "Read the blocked reason for a specific PR",
  },
);

const pullsRouteOpts = zodResponse(
  { ...bearerScope("read"), validate: { params: zodValidate(RepoParam) } },
  BlockedPullsSchema,
  {
    name: "BlockedPulls",
    description: "Read the blocked PRs for a specific repo",
  },
);

export function blockedReasonsRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/pulls/{number}/blocked-reason",
      options: reasonRouteOpts,
      handler: handleBlockedReason(getPool),
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/blocked-pulls",
      options: pullsRouteOpts,
      handler: handleBlockedPulls(getPool),
    },
  ];
}

const sqlReason =
  "SELECT repo, pr_number, reason, detail, since, updated_at FROM pipeline.pr_blocked_reasons WHERE repo = $1 AND pr_number = $2";

function handleBlockedReason(getPool: () => Pool | null) {
  return withPool(getPool, async (pool, req, h) => {
    const { owner, repo, number } = req.params as unknown as z.infer<
      typeof PrParam
    >;
    const fullRepo = `${owner}/${repo}`;

    try {
      const { rows } = await pool.query(sqlReason, [fullRepo, number]);
      const res = rows.length ? mapRow(rows[0]) : emptyReason(fullRepo, number);

      return h.response(res);
    } catch (err) {
      console.error("[blocked-reason] Error:", errorMessage(err));

      return h.response().code(500);
    }
  });
}

const sqlPulls =
  "SELECT repo, pr_number, reason, detail, since, updated_at FROM pipeline.pr_blocked_reasons WHERE repo = $1";

function handleBlockedPulls(getPool: () => Pool | null) {
  return withPool(getPool, async (pool, req, h) => {
    const { owner, repo } = req.params as unknown as z.infer<typeof RepoParam>;

    try {
      const { rows } = await pool.query(sqlPulls, [`${owner}/${repo}`]);

      return h.response({ pulls: rows.map(mapRow) });
    } catch (err) {
      console.error("[blocked-pulls] Error:", errorMessage(err));

      return h.response().code(500);
    }
  });
}

function withPool(
  getPool: () => Pool | null,
  handler: (pool: Pool, req: Request, h: ResponseToolkit) => Promise<unknown>,
) {
  return async (req: Request, h: ResponseToolkit) => {
    const pool = getPool();

    if (!pool) {
      return h.response().code(503);
    }

    return handler(pool, req, h);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): BlockedReason {
  return {
    repo: row.repo,
    prNumber: row.pr_number,
    reason: row.reason,
    label: labelForReason(row.reason, row.detail),
    detail: row.detail,
    since: row.since ? new Date(row.since).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

const emptyReason = (repo: string, prNumber: number) => ({
  repo,
  prNumber,
  reason: null,
  label: null,
  detail: null,
  since: null,
  updatedAt: null,
});

const labels: Record<string, string | ((d: string | null) => string)> = {
  waiting_on_ci: "Waiting for CI",
  required_check_missing: (d) =>
    `A required check has not run: ${d || "unknown"}`,
  needs_approval: "Needs one approval",
  needs_code_owner: "Needs a code owner's approval",
  base_behind: (d) => `Behind ${d || "base"}; needs the base merged in`,
  blocked_by_pr: (d) => `Waiting for #${d || "unknown"} to merge first`,
  review_in_flight: "Lore's review is still running",
  merge_conflict: (d) => `Conflicts with ${d || "base"}`,
  github_refused: (d) => `GitHub refused the merge: ${d || "unknown"}`,
};

function labelForReason(
  reason: string | null,
  detail: string | null,
): string | null {
  if (!reason) {
    return null;
  }
  const label = labels[reason];

  return typeof label === "function" ? label(detail) : label || reason;
}
