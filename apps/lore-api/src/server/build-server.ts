/**
 * The lore-api HTTP server (hapi) — the single construction site (FR3).
 *
 * `buildServer(getPool)` returns a configured hapi Server shared by BOTH
 * production boot (`http-server.ts`) and the tests (`inject` / `start`).
 *
 * Strangler-fig migration (ADR-033): from PR #1 hapi hosts 100% of traffic, but
 * every route is still served by the legacy `node:http` dispatcher
 * (`handleApiRoute`) through ONE catch-all bridge below. Native hapi routes,
 * added one group per PR, win over `/{any*}` by specificity and take that group
 * off the bridge. When the last group migrates, the bridge — and the legacy
 * dispatcher — are deleted.
 */

import Hapi from "@hapi/hapi";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { traceHttp } from "@re-cinq/lore-server-core/platform/otel.js";
import { handleApiRoute } from "../api/routes.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerBearerScope } from "./plugins/bearer-scope.js";
import { healthzRoute } from "../api/routes/healthz/healthz.js";
import { distRoute } from "../api/routes/dist/dist.js";
import { repoStatusRoute } from "../api/routes/repos/repo-status.js";
import { reposRoute } from "../api/routes/repos/repos.js";
import { prStatusRoute } from "../api/routes/repos/pr-status.js";
import { contextRoute } from "../api/routes/context/context.js";
import { graphRoute } from "../api/routes/graph/graph.js";
import { getTaskRoute } from "../api/routes/tasks/get-task.js";
import { listTasksRoute } from "../api/routes/tasks/list-tasks.js";
import { timelineRoute } from "../api/routes/tasks/task-timeline.js";
import { taskByPrRoute } from "../api/routes/tasks/task-by-pr.js";
import { taskLogsGetRoute, taskLogsPostRoute } from "../api/routes/tasks/task-logs.js";
import { jobRunLogsRoute } from "../api/routes/tasks/job-run-logs.js";
import { taskPostRoute } from "../api/routes/tasks/task-post.js";
import { memoryRoute } from "../api/routes/memory/memory.js";
import { episodeRoute } from "../api/routes/memory/episode.js";
import { sessionSummaryRoute } from "../api/routes/memory/session-summary.js";
import { ingestRoute } from "../api/routes/ingest/ingest.js";
import { ingestGraphRoute } from "../api/routes/ingest/ingest-graph.js";
import { onboardRoute } from "../api/routes/repos/onboard.js";

// 1 MB — the body cap for NATIVE routes (the hapi-native replacement for the
// old manual gate). Native routes inherit it from the server payload default.
const MAX_BODY_BYTES = 1_048_576;

// The bridge keeps the legacy caps authoritative for un-migrated routes: the old
// server's 1 MB Content-Length 413 (re-enforced below for exact parity) and
// `readJsonBody`'s own 1 MB stream cap. hapi must not pre-reject before those
// run, so the bridge accepts a generous body.
const BRIDGE_MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Adapt a hapi request to the `(req, res, pool)` shape the legacy dispatcher
 * expects. hapi has already read the payload (`parse: false` → Buffer), which
 * consumes `request.raw.req`; we hand the dispatcher a fresh Readable carrying
 * that body plus the raw url (with query string), method, and headers, and let
 * the dispatcher write `request.raw.res` directly.
 */
function bridgeRequest(request: Hapi.Request): IncomingMessage {
  const raw = request.raw.req;
  const body = Buffer.isBuffer(request.payload) ? request.payload : Buffer.alloc(0);
  return Object.assign(Readable.from([body]), {
    url: raw.url,
    method: raw.method,
    headers: raw.headers,
  }) as unknown as IncomingMessage;
}

export function buildServer(getPool: () => any, port = 0): Hapi.Server {
  const server = Hapi.server({
    port,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  registerRateLimit(server);
  registerBearerScope(server, getPool);

  // Native hapi routes, migrated one group per PR. They win over the catch-all
  // bridge below by specificity, taking their group off the legacy dispatcher.
  server.route([
    healthzRoute(getPool),
    distRoute(),
    repoStatusRoute(getPool),
    reposRoute(getPool),
    prStatusRoute(),
    contextRoute(getPool),
    graphRoute(getPool),
    getTaskRoute(),
    listTasksRoute(),
    timelineRoute(getPool),
    taskByPrRoute(getPool),
    taskLogsGetRoute(getPool),
    jobRunLogsRoute(),
    taskPostRoute(getPool),
    taskLogsPostRoute(),
    memoryRoute(getPool),
    episodeRoute(getPool),
    sessionSummaryRoute(getPool),
    ingestRoute(getPool),
    ingestGraphRoute(getPool),
    onboardRoute(getPool),
  ]);

  // The strangler bridge. Everything that is not yet a native hapi route falls
  // through here and is served by the legacy dispatcher, unchanged: it does its
  // own rate limiting and bearer-scope auth, so the bridge opts out (`auth:
  // false`) and leaves the payload unparsed for it.
  server.route({
    method: "*",
    path: "/{any*}",
    options: { auth: false, payload: { parse: false, maxBytes: BRIDGE_MAX_BODY_BYTES } },
    handler: async (request, h) => {
      const raw = request.raw.req;
      const res = request.raw.res;

      // Preserve the old http-server.ts 1 MB Content-Length gate byte-for-byte.
      if (raw.method === "POST") {
        const contentLength = parseInt(raw.headers["content-length"] || "0", 10);
        if (contentLength > MAX_BODY_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "request body too large" }));
          return h.abandon;
        }
      }

      const start = Date.now();
      const handled = await handleApiRoute(bridgeRequest(request), res, getPool());
      if (!handled) res.writeHead(404).end();
      traceHttp(raw.method || "GET", raw.url || "/", res.statusCode, Date.now() - start);
      return h.abandon;
    },
  });

  return server;
}
