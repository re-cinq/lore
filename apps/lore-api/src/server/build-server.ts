/**
 * The lore-api HTTP server (hapi) — the single construction site (FR3), shared
 * by production boot (`http-server.ts`) and the tests (`inject` / `start`).
 *
 * End state of the strangler-fig migration (ADR-033): lore-api is pure hapi.
 * Every `/api/*` route is a native hapi route; the legacy `node:http` dispatcher
 * and its catch-all bridge are gone. Cross-cutting concerns are hapi plugins:
 * request tracing, rate limiting, and the bearer-scope auth strategy.
 */

import Hapi from "@hapi/hapi";
import type { ServerRoute } from "@hapi/hapi";
import { registerRequestTracing } from "./plugins/tracing.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerBearerScope } from "./plugins/bearer-scope.js";
import { zodFailAction } from "./plugins/zod-validate.js";
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
import { slackWebhookRoute } from "../api/routes/webhooks/webhook-slack.js";
import { incidentWebhookRoute } from "../api/routes/webhooks/webhook-incident.js";
import { webhookStatusRoute, webhookSecretRoute, webhookEnsureRoute } from "../api/routes/webhooks/webhook.js";
import { tokensRoute } from "../api/routes/tokens/tokens.js";
import { darkFactoryRoute } from "../api/routes/dark-factory/dark-factory.js";
import { agentsGetRoute, agentsPostRoute, agentsPutRoute, agentsDeleteRoute } from "../api/routes/agent-definitions/agents.js";
import { impactRoute } from "../api/routes/impact/impact.js";
import { traceRoute } from "../api/routes/trace/trace.js";
import { traceSpecsRoute } from "../api/routes/trace/trace-specs.js";
import { featuresRoutes } from "../api/routes/features/features.js";

// 1 MB body cap applied to every native route via the server payload default.
const MAX_BODY_BYTES = 1_048_576;

/**
 * The single ordered list of native `/api/*` routes. The one source of truth for
 * the API surface: `buildServer` registers it, and the OpenAPI generator (ADR-035)
 * walks the same array — so the document describes exactly what the server runs,
 * with no parallel registry.
 */
export function routeList(getPool: () => any): ServerRoute[] {
  return [
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
    slackWebhookRoute(getPool),
    incidentWebhookRoute(getPool),
    webhookStatusRoute(),
    webhookEnsureRoute(),
    webhookSecretRoute(),
    tokensRoute(getPool),
    darkFactoryRoute(getPool),
    agentsGetRoute(getPool),
    agentsPostRoute(getPool),
    agentsPutRoute(getPool),
    agentsDeleteRoute(getPool),
    impactRoute(),
    traceRoute(),
    traceSpecsRoute(),
    ...featuresRoutes(),
  ];
}

export function buildServer(getPool: () => any, port = 0): Hapi.Server {
  const server = Hapi.server({
    port,
    host: "0.0.0.0",
    routes: {
      // ADR-034: parse every request body as JSON regardless of the client's
      // Content-Type. The pre-hapi handlers JSON.parsed the raw body content-type-
      // agnostically; `override` preserves that so a JSON body with a missing or
      // wrong Content-Type still parses (real clients send application/json).
      // Webhook routes set `parse: false` and own their raw body — unaffected.
      payload: { maxBytes: MAX_BODY_BYTES, override: "application/json" },
      // zod schemas on native routes fail through this shared action, shaping
      // every validation error into the { error } 400 body. Inert until a route
      // declares `options.validate`.
      validate: { failAction: zodFailAction },
    },
  });

  registerRequestTracing(server);
  registerRateLimit(server);
  registerBearerScope(server, getPool);

  server.route(routeList(getPool));

  return server;
}
