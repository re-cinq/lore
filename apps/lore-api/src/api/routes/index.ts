/**
 * HTTP API router. Runs cross-cutting gates (rate limit + bearer-token
 * scope auth), then matches the request against an ordered route table
 * and delegates to the area handler. Handlers live in sibling modules;
 * this file owns only dispatch.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { json } from "./http.js";
import { rateLimit, getRequiredScope, validateClientToken, type RateBucket } from "./auth.js";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
) => Promise<void>;

interface ApiRoute {
  match: (url: string, method: string) => boolean;
  handle: RouteHandler;
}

// Every route group has migrated to native hapi routes (Phase 12). The dispatcher
// now only runs the cross-cutting gates and always misses (returns false → the
// bridge 404s). The whole dispatcher is deleted at teardown (Phase 13).
const API_ROUTES: ApiRoute[] = [];

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "";

  // Rate limiting (healthz is exempt)
  if (url !== "/healthz") {
    const bucket: RateBucket = url.startsWith("/api/webhook/") ? "webhook"
      : (url === "/api/task" || url.startsWith("/api/task/") || url.startsWith("/api/tasks")) ? "task"
      : "default";
    if (!rateLimit(bucket)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" })
        .end(JSON.stringify({ error: "rate limit exceeded" }));
      return true;
    }
  }

  // Centralized auth — webhooks have their own HMAC auth, healthz is public
  const authExempt = url === "/healthz" || url.startsWith("/api/webhook/") || url.startsWith("/dist/");
  if (!authExempt) {
    const bearer = req.headers.authorization?.replace("Bearer ", "");
    if (!bearer) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const scope = getRequiredScope(url, method);
    const valid = await validateClientToken(pool, bearer, scope);
    if (!valid) {
      json(res, 403, { error: "insufficient scope" });
      return true;
    }
  }

  const route = API_ROUTES.find((r) => r.match(url, method));
  if (!route) return false;
  await route.handle(req, res, pool);
  return true;
}
