import { errorMessage } from "@re-cinq/lore-shared";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { bearerScope } from "../http/bearer-scope.js";

export function autoMergeKpisRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/auto-merge/kpis",
    options: {
      ...bearerScope("read"),
      description: "Auto-merge KPIs from pipeline.v_auto_merge_kpis",
    },
    handler: (request, h) => serveAutoMergeKpis(request, h, getPool),
  };
}

async function serveAutoMergeKpis(
  request: Request,
  h: ResponseToolkit,
  getPool: () => Pool | null,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), "Database pool not available");

  try {
    const res = await pool.query(
      `SELECT task_group_id, pr_number, merged_without_human, dependent_merged_before_dependency, sensitive_merged_without_codeowner FROM pipeline.v_auto_merge_kpis WHERE repo = $1`,
      [`${request.params.owner}/${request.params.repo}`],
    );

    return h.response({ kpis: res.rows });
  } catch (err) {
    rethrowBoom(err);

    return h.response({ error: errorMessage(err) }).code(500);
  }
}
