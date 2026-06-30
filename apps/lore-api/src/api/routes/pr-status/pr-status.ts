/**
 * `GET /api/pr-status?repo=owner/name&pr_number=N` — live PR/CI/review verdict
 * from GitHub. Server-side because it needs the GitHub App credentials; the
 * local `lore_get_pr_status` tool proxies here instead of carrying octokit.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { fetchPrStatus } from "../../../platform/github-client.js";
import { json } from "../http.js";

export async function handlePrStatus(req: IncomingMessage, res: ServerResponse, _pool: Pool | null): Promise<void> {
  const url = new URL(req.url || "", "http://localhost");
  const repo = url.searchParams.get("repo");
  const prNumber = Number(url.searchParams.get("pr_number"));
  if (!repo || !repo.includes("/") || !Number.isInteger(prNumber)) {
    json(res, 400, { error: "required: repo (owner/name), pr_number (integer)" });
    return;
  }
  try {
    const result = await fetchPrStatus(repo, prNumber);
    if (!result) {
      // 424 (not 502): a missing-GitHub-credentials config gap is deterministic,
      // so the proxy must classify it non-retriable and not burn its retry budget
      // or report it as a transient Lore-API outage.
      json(res, 424, { error: "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN." });
      return;
    }
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
