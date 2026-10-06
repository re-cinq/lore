/** Rate limiting as a hapi extension (ADR-033). */

import type { Server } from "@hapi/hapi";
import { rateLimit, type RateBucket } from "./auth.js";

export const GITHUB_WEBHOOK_PATH = "/api/webhook/github";

type RouteBucket = RateBucket | "unlimited";

const BUCKET_RULES: ReadonlyArray<{
  matches: (path: string) => boolean;
  bucket: RouteBucket;
}> = [
  // The probes, and GitHub's deliveries: GitHub never retries a refused delivery, so a 429 there is an event lost for good.
  {
    matches: (path) => path === "/healthz" || path === GITHUB_WEBHOOK_PATH,
    bucket: "unlimited",
  },
  { matches: (path) => path.startsWith("/api/webhook/"), bucket: "webhook" },
  {
    matches: (path) =>
      path === "/api/task" ||
      path.startsWith("/api/task/") ||
      path.startsWith("/api/tasks"),
    bucket: "task",
  },
  {
    matches: (path) => path === "/api/embeddings",
    bucket: "embed",
  },
  { matches: (path) => path.startsWith("/api/task-turns/"), bucket: "turns" },
];

/** The single path→bucket rule, shared by the ext and the OpenAPI generator (ADR-035). */
export function bucketFor(path: string): RouteBucket {
  return BUCKET_RULES.find((rule) => rule.matches(path))?.bucket ?? "default";
}

export function registerRateLimit(server: Server): void {
  server.ext("onPreAuth", (request, h) => {
    const bucket = bucketFor(request.path);

    if (bucket === "unlimited" || rateLimit(bucket)) {
      return h.continue;
    }

    return h
      .response({ error: "rate limit exceeded" })
      .code(429)
      .header("Retry-After", "60")
      .takeover();
  });
}
