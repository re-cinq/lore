import type { Pool } from "pg";
/** Lore-api HTTP server construction (hapi, ADR-033); shared by production and tests via buildServer. */

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
import { ingestStateRoute } from "../api/routes/ingest/ingest-state.js";
import { ingestDeltaRoute } from "../api/routes/ingest/ingest-delta.js";
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
import { clusterAgentCatalogEventsRoute } from "../api/routes/cluster-agents/catalog-events.js";
import { clusterAgentCatalogStatusRoute } from "../api/routes/cluster-agents/catalog-status.js";
import { agentDefinitionUsageRoute } from "../api/routes/agent-definitions/usage.js";
import { orgAgentDefinitionsRoute } from "../api/routes/agent-definitions/org-list.js";
import { orgAgentDefinitionUpdateRoute } from "../api/routes/agent-definitions/org-update.js";
import { clusterAgentInstallRoutes } from "../api/routes/cluster-agents/install.js";
import { clusterAgentPauseRoute } from "../api/routes/cluster-agents/pause.js";
import { clusterAgentRestartRoute } from "../api/routes/cluster-agents/restart.js";
import { clusterAgentHeartbeatRoute } from "../api/routes/cluster-agents/heartbeat.js";
import { clusterAgentReleaseRoute } from "../api/routes/cluster-agents/release.js";
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
import { analyticsOverviewRoute } from "../api/routes/analytics/spend.js";
import { creditLedgerRoute } from "../api/routes/analytics/credit-ledger.js";
import { spendWindowRoute } from "../api/routes/analytics/spend-window.js";
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

/** Single source of truth for /api/* routes; OpenAPI generator walks this array (ADR-035). */
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
    ingestStateRoute(getPool),
    ingestDeltaRoute(getPool),
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
    clusterAgentCatalogEventsRoute(getPool),
    ...clusterAgentInstallRoutes(),
    clusterAgentPauseRoute(getPool),
    clusterAgentRestartRoute(getPool),
    clusterAgentHeartbeatRoute(getPool),
    clusterAgentReleaseRoute(getPool),
    clusterAgentListRoute(getPool),
    ...darkFactoryRoute(getPool),
    agentsGetRoute(getPool),
    agentDefinitionUsageRoute(getPool),
    clusterAgentCatalogStatusRoute(getPool),
    orgAgentDefinitionsRoute(getPool),
    orgAgentDefinitionUpdateRoute(getPool),
    agentsPostRoute(getPool),
    agentsPutRoute(getPool),
    agentsDeleteRoute(getPool),
    usageRoute(getPool),
    analyticsRoute(getPool),
    ...activityRoutes(getPool),
    spendWindowRoute(getPool),
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
    openApiJsonRoute(getPool, routeList),
    docsRoute(getPool, routeList),
    ...featuresRoutes(getPool),
    ...implementationLoopRoutes(getPool),
  ];
}

function logOpenApiCoverage(routes: ServerRoute[]): void {
  const { coverage } = generateOpenApi(routes);

  console.log(summarizeCoverage(coverage));

  if (coverage.uncovered.length) {
    console.warn(
      `[openapi] WARNING uncovered write routes: ${coverage.uncovered.join(", ")}`,
    );
  }
}

export function buildServer(getPool: () => Pool | null, port = 0): Hapi.Server {
  const server = Hapi.server({
    port,
    host: "0.0.0.0",
    routes: {
      // ADR-034: parse JSON regardless of Content-Type (preserve pre-hapi agnostic behavior).
      payload: { maxBytes: MAX_BODY_BYTES, override: "application/json" },
      // Zod schemas fail through zodFailAction, shaping every 400 as { error }.
      validate: { failAction: zodFailAction },
    },
  });

  registerRequestTracing(server);
  registerRateLimit(server);
  registerBearerScope(server, getPool);

  const routes = routeList(getPool);

  server.route(routes);

  // Surface OpenAPI coverage at boot (FR7, drift-guard test enforces via CI).
  if (!process.env.VITEST) {
    logOpenApiCoverage(routes);
  }

  return server;
}
