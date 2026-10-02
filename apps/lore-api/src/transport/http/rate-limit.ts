/** Rate limiting as a hapi extension (ADR-033). */

import { createHash } from "node:crypto";
import type { Request, ResponseToolkit, Server } from "@hapi/hapi";
import { rateLimit, type RateBucket } from "./auth.js";
import { clientAddress } from "./client-ip.js";

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
  {
    matches: (path) => path === "/api/embeddings",
    bucket: "embed",
  },
  { matches: (path) => path.startsWith("/api/task-turns/"), bucket: "turns" },
  {
    matches: (path) =>
      /^\/api\/cluster-agents\/[^/]+\/(claim|heartbeat|release|catalog-events|catalog-status)$/.test(
        path,
      ),
    bucket: "agent",
  },
];

/** The single path→bucket rule, shared by the ext and the OpenAPI generator (ADR-035). */
export function bucketFor(path: string): RateBucket {
  return BUCKET_RULES.find((rule) => rule.matches(path))?.bucket ?? "default";
}

export function registerRateLimit(server: Server): void {
  server.ext("onPreAuth", beforeAuth);
  server.ext("onPostAuth", afterAuth);
  server.ext("onPreResponse", beforeResponse);
}

function beforeAuth(request: Request, h: ResponseToolkit) {
  if (isProbe(request) || bearerOf(request)) {
    return h.continue;
  }

  return admit(request, h, addressPrincipal(request));
}

function afterAuth(request: Request, h: ResponseToolkit) {
  const bearer = bearerOf(request);

  if (isProbe(request) || !bearer) {
    return h.continue;
  }
  const principal = request.auth.isAuthenticated
    ? tokenPrincipal(bearer)
    : addressPrincipal(request);

  return admit(request, h, principal);
}

function beforeResponse(request: Request, h: ResponseToolkit) {
  if (isProbe(request) || !bearerOf(request) || isCounted(request)) {
    return h.continue;
  }

  return admit(request, h, addressPrincipal(request));
}

type Counted = { rateCounted?: true };

function isCounted(request: Request): boolean {
  return (request.plugins as Counted).rateCounted === true;
}

function admit(request: Request, h: ResponseToolkit, principal: string) {
  (request.plugins as Counted).rateCounted = true;

  return rateLimit(bucketFor(request.path), principal)
    ? h.continue
    : h
        .response({ error: "rate limit exceeded" })
        .code(429)
        .header("Retry-After", "60")
        .takeover();
}

function isProbe(request: Request): boolean {
  // liveness/readiness probes
  return request.path === "/healthz";
}

function bearerOf(request: Request): string | undefined {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;

  return value?.replace("Bearer ", "") || undefined;
}

function addressPrincipal(request: Request): string {
  const address = clientAddress(
    request.info.remoteAddress,
    request.headers["x-forwarded-for"],
  );
  const agent = /^\/api\/cluster-agents\/([^/]+)\//.exec(request.path)?.[1];

  return agent ? `ip:${address}:${agent}` : `ip:${address}`;
}

function tokenPrincipal(bearer: string): string {
  return `token:${createHash("sha256").update(bearer).digest("hex")}`;
}
