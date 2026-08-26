import type { Pool } from "pg";
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
import {
  generateOpenApi,
  summarizeCoverage,
} from "../openapi/build-document.js";
import { healthzRoute } from "../api/routes/healthz/healthz.js";
import { llmStatusRoute } from "../api/routes/platform/llm-status.js";
import { distRoute } from "../api/routes/dist/dist.js";
import { repoStatusRoute } from "../api/routes/repos/repo-status.js";
import { reposRoute } from "../api/routes/repos/repos.js";
import { repoRecordRoute } from "../api/routes/repos/repo-record.js";
import { orgSettingsRoutes } from "../api/routes/repos/org-settings.js";
import { repoSettingsRoute } from "../api/routes/repos/repo-settings.js";
import { prStatusRoute } from "../api/routes/repos/pr-status.js";
import { contextRoute } from "../api/routes/context/context.js";
import { chunkBrowseRoutes } from "../api/routes/context/chunks-browse.js";
import { graphRoute } from "../api/routes/graph/graph.js";
import { getTaskRoute } from "../api/routes/tasks/get-task.js";
import { listTasksRoute } from "../api/routes/tasks/list-tasks.js";
import { timelineRoute } from "../api/routes/tasks/task-timeline.js";
import { taskRunsRoute } from "../api/routes/tasks/task-runs.js";
import { taskViewRoutes } from "../api/routes/tasks/task-views.js";
import { assemblyLineRoutes } from "../api/routes/assembly-lines/assembly-lines.js";
import { startRunRoute } from "../api/routes/assembly-lines/start-run.js";
import { runReadRoute } from "../api/routes/assembly-lines/run-read.js";
import { taskByPrRoute } from "../api/routes/tasks/task-by-pr.js";
import {
  taskLogsGetRoute,
  taskLogsPostRoute,
} from "../api/routes/tasks/task-logs.js";
import { taskTurnsPostRoute } from "../api/routes/tasks/task-turns.js";
import { jobRunLogsRoute } from "../api/routes/tasks/job-run-logs.js";
import { taskPostRoute } from "../api/routes/tasks/task-post.js";
import { taskGroupRoute } from "../api/routes/tasks/task-group.js";
import {
  specTasksSyncRoute,
  specTasksReadyRoute,
  specTasksClaimRoute,
  specTasksCompleteRoute,
} from "../api/routes/spec-tasks/spec-tasks.js";
import { memoryRoute } from "../api/routes/memory/memory.js";
import { memoryBrowseRoutes } from "../api/routes/memory/memory-browse.js";
import { episodeRoute } from "../api/routes/memory/episode.js";
import { sessionSummaryRoute } from "../api/routes/memory/session-summary.js";
import { ingestRoute } from "../api/routes/ingest/ingest.js";
import { ingestGraphRoute } from "../api/routes/ingest/ingest-graph.js";
import { eventPayloadRoute } from "../api/routes/ingest/event-payload.js";
import { embedRoute } from "../api/routes/ingest/embed.js";
import { onboardRoute } from "../api/routes/repos/onboard.js";
import { slackWebhookRoute } from "../api/routes/webhooks/webhook-slack.js";
import { incidentWebhookRoute } from "../api/routes/webhooks/webhook-incident.js";
import {
  webhookStatusRoute,
  webhookSecretRoute,
  webhookEnsureRoute,
} from "../api/routes/webhooks/webhook.js";
import { tokensRoute } from "../api/routes/tokens/tokens.js";
import { clusterAgentRegisterRoute } from "../api/routes/cluster-agents/register.js";
import { clusterAgentClaimRoute } from "../api/routes/cluster-agents/claim.js";
import { clusterAgentInstallRoutes } from "../api/routes/cluster-agents/install.js";
import { clusterAgentHeartbeatRoute } from "../api/routes/cluster-agents/heartbeat.js";
import { clusterAgentListRoute } from "../api/routes/cluster-agents/list.js";
import { darkFactoryRoute } from "../api/routes/dark-factory/dark-factory.js";
import {
  agentsGetRoute,
  agentsPostRoute,
  agentsPutRoute,
  agentsDeleteRoute,
} from "../api/routes/agent-definitions/agents.js";
import { usageRoute } from "../api/routes/analytics/usage.js";
import { analyticsRoute } from "../api/routes/analytics/analytics.js";
import { activityRoutes } from "../api/routes/analytics/activity.js";
import {
  spendRoute,
  analyticsOverviewRoute,
} from "../api/routes/analytics/spend.js";
import { creditLedgerRoute } from "../api/routes/analytics/credit-ledger.js";
import { agentStatsRoute } from "../api/routes/analytics/agent-stats.js";
import { impactRoute } from "../api/routes/impact/impact.js";
import { impactBaseRoute } from "../api/routes/impact/impact-base.js";
import { traceRoute } from "../api/routes/trace/trace.js";
import { chunksRoute } from "../api/routes/repos/chunks.js";
import { stationDataRoutes } from "../api/routes/repos/station-data.js";
import { traceAdrsRoute } from "../api/routes/trace/trace-adrs.js";
import { traceSpecsRoute } from "../api/routes/trace/trace-specs.js";
import { featuresRoutes } from "../api/routes/features/features.js";
import { implementationLoopRoutes } from "../api/routes/backlog/backlog.js";
import { openApiJsonRoute, docsRoute } from "../api/routes/openapi/openapi.js";

// 1 MB body cap applied to every native route via the server payload default.
const MAX_BODY_BYTES = 1_048_576;

/**
 * The single ordered list of native `/api/*` routes. The one source of truth for
 * the API surface: `buildServer` registers it, and the OpenAPI generator (ADR-035)
 * walks the same array — so the document describes exactly what the server runs,
 * with no parallel registry.
 */
export function routeList(getPool: () => Pool | null): ServerRoute[] {
  return [
    healthzRoute(getPool),
    llmStatusRoute(getPool),
    distRoute(),
    repoStatusRoute(getPool),
    reposRoute(getPool),
    repoRecordRoute(),
    ...orgSettingsRoutes(getPool),
    repoSettingsRoute(getPool),
    prStatusRoute(),
    contextRoute(getPool),
    ...chunkBrowseRoutes(getPool),
    graphRoute(getPool),
    getTaskRoute(),
    listTasksRoute(),
    timelineRoute(getPool),
    taskRunsRoute(getPool),
    ...taskViewRoutes(getPool),
    ...assemblyLineRoutes(getPool),
    startRunRoute(),
    runReadRoute(getPool),
    taskByPrRoute(getPool),
    taskLogsGetRoute(getPool),
    jobRunLogsRoute(),
    taskPostRoute(getPool),
    taskGroupRoute(getPool),
    specTasksSyncRoute(getPool),
    specTasksReadyRoute(getPool),
    specTasksClaimRoute(getPool),
    specTasksCompleteRoute(getPool),
    taskLogsPostRoute(),
    taskTurnsPostRoute(getPool),
    memoryRoute(getPool),
    ...memoryBrowseRoutes(getPool),
    episodeRoute(getPool),
    sessionSummaryRoute(getPool),
    ingestRoute(getPool),
    ingestGraphRoute(getPool),
    eventPayloadRoute(getPool),
    embedRoute(),
    onboardRoute(getPool),
    slackWebhookRoute(getPool),
    incidentWebhookRoute(getPool),
    webhookStatusRoute(),
    webhookEnsureRoute(),
    webhookSecretRoute(),
    ...tokensRoute(getPool),
    clusterAgentRegisterRoute(getPool),
    clusterAgentClaimRoute(getPool),
    ...clusterAgentInstallRoutes(),
    clusterAgentHeartbeatRoute(getPool),
    clusterAgentListRoute(getPool),
    ...darkFactoryRoute(getPool),
    agentsGetRoute(getPool),
    agentsPostRoute(getPool),
    agentsPutRoute(getPool),
    agentsDeleteRoute(getPool),
    usageRoute(getPool),
    analyticsRoute(getPool),
    ...activityRoutes(getPool),
    spendRoute(getPool),
    creditLedgerRoute(getPool),
    analyticsOverviewRoute(getPool),
    agentStatsRoute(getPool),
    impactRoute(),
    impactBaseRoute(),
    traceRoute(),
    chunksRoute(),
    ...stationDataRoutes(),
    traceAdrsRoute(),
    traceSpecsRoute(),
    openApiJsonRoute(getPool),
    docsRoute(getPool),
    ...featuresRoutes(getPool),
    ...implementationLoopRoutes(getPool),
  ];
}

export function buildServer(getPool: () => Pool | null, port = 0): Hapi.Server {
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

  const routes = routeList(getPool);

  server.route(routes);

  // FR7: surface OpenAPI coverage once at boot so drops/uncovered routes are not
  // silent. Quiet under vitest to keep test output clean; the drift-guard test is
  // the CI enforcement.
  if (!process.env.VITEST) {
    const { coverage } = generateOpenApi(routes);

    console.log(summarizeCoverage(coverage));

    if (coverage.uncovered.length) {
      console.warn(
        `[openapi] WARNING uncovered write routes: ${coverage.uncovered.join(", ")}`,
      );
    }
  }

  return server;
}
