/**
 * `GET /api/pr-status?repo=owner/name&pr_number=N` — live PR/CI/review verdict
 * from GitHub. Server-side because it needs the GitHub App credentials; the
 * local `lore_get_pr_status` tool proxies here instead of carrying octokit.
 */

import type { ServerRoute } from "@hapi/hapi";
import { fetchPrStatus } from "../../../platform/github-client.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export function prStatusRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/pr-status",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const repo = request.query.repo as string | undefined;
      const prNumber = Number((request.query.pr_number as string | undefined) ?? null);
      if (!repo || !repo.includes("/") || !Number.isInteger(prNumber)) {
        return h.response({ error: "required: repo (owner/name), pr_number (integer)" }).code(400);
      }
      try {
        const result = await fetchPrStatus(repo, prNumber);
        if (!result) {
          // 424 (not 502): a missing-GitHub-credentials config gap is deterministic,
          // so the proxy must classify it non-retriable and not burn its retry budget
          // or report it as a transient Lore-API outage.
          return h.response({ error: "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN." }).code(424);
        }
        return h.response(result);
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
