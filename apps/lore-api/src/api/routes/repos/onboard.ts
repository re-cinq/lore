import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { onboardRepo } from "../../../features/repo/repo-onboard.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { rawBody } from "../../../server/raw-body.js";

export function onboardRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/onboard",
    options: { ...bearerScope("admin"), payload: { parse: false } },
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool) return h.response({ error: "database not available" }).code(503);
      try {
        const { repo } = JSON.parse(rawBody(request));
        if (!repo || !repo.includes("/")) return h.response({ error: "required: repo (owner/name format)" }).code(400);
        return h.response(await onboardRepo(pool, repo));
      } catch (err: any) {
        console.error("[onboard] API error:", err.message);
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
