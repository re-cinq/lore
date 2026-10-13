import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
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

export function blockedReasonsRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/pulls/{number}/blocked-reason",
      options: zodResponse(
        {
          ...bearerScope("read"),
          validate: { params: zodValidate(PrParam) },
        },
        BlockedReasonSchema,
        {
          name: "BlockedReason",
          description: "Read the blocked reason for a specific PR",
        },
      ),
      handler: async (request: Request, h: ResponseToolkit) => {
        const pool = getPool();
        if (!pool) return h.response().code(503);
        const params = request.params as z.infer<typeof PrParam>;
        const repoFullName = `${params.owner}/${params.repo}`;

        try {
          const { rows } = await pool.query(
            `SELECT repo, pr_number, reason, detail, since, updated_at
             FROM pipeline.pr_blocked_reasons
             WHERE repo = $1 AND pr_number = $2`,
            [repoFullName, params.number],
          );

          if (rows.length === 0) {
            return h.response({
              repo: repoFullName,
              prNumber: params.number,
              reason: null,
              label: null,
              detail: null,
              since: null,
              updatedAt: null,
            });
          }

          const row = rows[0];
          return h.response({
            repo: row.repo,
            prNumber: row.pr_number,
            reason: row.reason,
            label: labelForReason(row.reason, row.detail),
            detail: row.detail,
            since: row.since ? new Date(row.since).toISOString() : null,
            updatedAt: row.updated_at
              ? new Date(row.updated_at).toISOString()
              : null,
          });
        } catch (err) {
          console.error("[blocked-reason] Error:", errorMessage(err));
          return h.response().code(500);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/blocked-pulls",
      options: zodResponse(
        {
          ...bearerScope("read"),
          validate: { params: zodValidate(RepoParam) },
        },
        BlockedPullsSchema,
        {
          name: "BlockedPulls",
          description: "Read the blocked PRs for a specific repo",
        },
      ),
      handler: async (request: Request, h: ResponseToolkit) => {
        const pool = getPool();
        if (!pool) return h.response().code(503);
        const params = request.params as z.infer<typeof RepoParam>;
        const repoFullName = `${params.owner}/${params.repo}`;

        try {
          const { rows } = await pool.query(
            `SELECT repo, pr_number, reason, detail, since, updated_at
             FROM pipeline.pr_blocked_reasons
             WHERE repo = $1`,
            [repoFullName],
          );

          return h.response({
            pulls: rows.map((row) => ({
              repo: row.repo,
              prNumber: row.pr_number,
              reason: row.reason,
              label: labelForReason(row.reason, row.detail),
              detail: row.detail,
              since: row.since ? new Date(row.since).toISOString() : null,
              updatedAt: row.updated_at
                ? new Date(row.updated_at).toISOString()
                : null,
            })),
          });
        } catch (err) {
          console.error("[blocked-pulls] Error:", errorMessage(err));
          return h.response().code(500);
        }
      },
    },
  ];
}

function labelForReason(
  reason: string | null,
  detail: string | null,
): string | null {
  if (!reason) return null;
  switch (reason) {
    case "waiting_on_ci":
      return "Waiting for CI";
    case "required_check_missing":
      return `A required check has not run: ${detail || "unknown"}`;
    case "needs_approval":
      return "Needs one approval";
    case "needs_code_owner":
      return "Needs a code owner's approval";
    case "base_behind":
      return `Behind ${detail || "base"}; needs the base merged in`;
    case "blocked_by_pr":
      return `Waiting for #${detail || "unknown"} to merge first`;
    case "review_in_flight":
      return "Lore's review is still running";
    case "merge_conflict":
      return `Conflicts with ${detail || "base"}`;
    case "github_refused":
      return `GitHub refused the merge: ${detail || "unknown"}`;
    default:
      return reason;
  }
}
