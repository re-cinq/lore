/** Rate limiting as a hapi extension (ADR-033). */

import type { Server } from "@hapi/hapi";
import { rateLimit, type RateBucket } from "../../api/routes/auth.js";

/** The single path→bucket rule, shared by the ext and the OpenAPI generator (ADR-035). */
export function bucketFor(path: string): RateBucket {
  if (path.startsWith("/api/webhook/")) {
    return "webhook";
  }

  if (
    path === "/api/task" ||
    path.startsWith("/api/task/") ||
    path.startsWith("/api/tasks")
  ) {
    return "task";
  }

  if (path === "/api/embed") {
    return "embed";
  }

  if (path.startsWith("/api/task-turns/")) {
    return "turns";
  }

  return "default";
}

export function registerRateLimit(server: Server): void {
  server.ext("onPreAuth", (request, h) => {
    if (request.path === "/healthz") {
      return h.continue;
    } // liveness/readiness probes

    if (rateLimit(bucketFor(request.path))) {
      return h.continue;
    }

    return h
      .response({ error: "rate limit exceeded" })
      .code(429)
      .header("Retry-After", "60")
      .takeover();
  });
}
