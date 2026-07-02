/**
 * Rate limiting as a hapi `onPreAuth` extension — the framework-native
 * replacement for the manual gate in the legacy dispatcher (ADR-033). It reuses
 * the exact sliding-window buckets from `routes/auth.ts` (single source →
 * identical thresholds), so each request is counted once here (native routes) OR
 * once by the legacy dispatcher (routes still on the strangler bridge), never
 * both: the ext skips the catch-all bridge route and `/healthz` (limited /
 * exempted elsewhere). The 429 body + `Retry-After: 60` match the legacy gate
 * byte-for-byte.
 */

import type { Server } from "@hapi/hapi";
import { rateLimit, type RateBucket } from "../../api/routes/auth.js";

function bucketFor(path: string): RateBucket {
  if (path.startsWith("/api/webhook/")) return "webhook";
  if (path === "/api/task" || path.startsWith("/api/task/") || path.startsWith("/api/tasks")) return "task";
  return "default";
}

export function registerRateLimit(server: Server): void {
  server.ext("onPreAuth", (request, h) => {
    // The strangler bridge rate-limits its own requests; /healthz is exempt.
    if (request.route.path === "/{any*}" || request.path === "/healthz") return h.continue;
    if (rateLimit(bucketFor(request.path))) return h.continue;
    return h.response({ error: "rate limit exceeded" }).code(429).header("Retry-After", "60").takeover();
  });
}
