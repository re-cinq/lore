import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { getOnboardedReposWithCounts } from "../../../features/repo/repo-onboard.js";
import { json } from "../http.js";

export async function handleListRepos(_req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  try {
    const repos = await getOnboardedReposWithCounts(pool);
    json(res, 200, repos);
  } catch (err: any) {
    console.error("[repos] API error:", err.message);
    json(res, 500, { error: err.message });
  }
}
