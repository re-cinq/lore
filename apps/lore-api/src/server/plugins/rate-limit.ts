/** Rate limiting as a hapi extension (ADR-033). */

import type { Server } from "@hapi/hapi";
import { rateLimit, type RateBucket } from "../../api/routes/auth.js";

const BUCKET_RULES: ReadonlyArray<{
  matches: (path: string) => boolean;
  bucket: RateBucket;
}> = [
  { matches: (path) => path.startsWith("/api/webhook/"), bucket: "webhook" },
  {
    matches: (path) =>
      path === "/api/task" ||
      path.startsWith("/api/task/") ||
      path.startsWith("/api/tasks"),
    bucket: "task",
  },
  { matches: (path) => path === "/api/embed", bucket: "embed" },
  { matches: (path) => path.startsWith("/api/task-turns/"), bucket: "turns" },
];

/** The single path→bucket rule, shared by the ext and the OpenAPI generator (ADR-035). */
export function bucketFor(path: string): RateBucket {
  return BUCKET_RULES.find((rule) => rule.matches(path))?.bucket ?? "default";
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
