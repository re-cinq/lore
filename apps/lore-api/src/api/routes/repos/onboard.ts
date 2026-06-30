import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { onboardRepo } from "../../../features/repo/repo-onboard.js";
import { json, readBody } from "../http.js";

export async function handleOnboard(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const { repo } = JSON.parse(body);
    if (!repo || !repo.includes("/")) {
      json(res, 400, { error: "required: repo (owner/name format)" });
      return;
    }
    const result = await onboardRepo(pool, repo);
    json(res, 200, result);
  } catch (err: any) {
    console.error("[onboard] API error:", err.message);
    json(res, 500, { error: err.message });
  }
}
