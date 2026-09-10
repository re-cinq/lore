/** Single source of truth for /api/* routes; the OpenAPI generator walks this array (ADR-035). It is the api layer's own composition, so the generator can read it without reaching into the server that mounts it. */

import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { healthzRoute } from "./routes/healthz/healthz.js";
import { llmStatusRoute } from "./routes/platform/llm-status.js";
import { distRoute } from "./routes/dist/dist.js";
import { repoStatusRoute } from "./routes/repos/repo-status.js";
import { reposRoute } from "./routes/repos/repos.js";
import { repoRecordRoute } from "./routes/repos/repo-record.js";
import { orgSettingsRoutes } from "./routes/repos/org-settings.js";
import { repoSettingsRoute } from "./routes/repos/repo-settings.js";
import { prStatusRoute } from "./routes/repos/pr-status.js";
import { pullFilesRoute } from "./routes/repos/pull-files.js";
import { contextRoute } from "./routes/context/context.js";
import { chunkBrowseRoutes } from "./routes/context/chunks-browse.js";
import { graphRoute } from "./routes/graph/graph.js";
import { getTaskRoute } from "./routes/tasks/get-task.js";
import { listTasksRoute } from "./routes/tasks/list-tasks.js";
import { timelineRoute } from "./routes/tasks/task-timeline.js";
import { taskRunsRoute } from "./routes/tasks/task-runs.js";
import { taskViewRoutes } from "./routes/tasks/task-views.js";
import { assemblyLineRoutes } from "./routes/assembly-lines/assembly-lines.js";
import { startRunRoute } from "./routes/assembly-lines/start-run.js";
import { runReadRoute } from "./routes/assembly-lines/run-read.js";
import { runDodRoute } from "./routes/assembly-lines/run-dod.js";
import { runStreamRoute } from "./routes/assembly-lines/run-stream.js";
import { taskByPrRoute } from "./routes/tasks/task-by-pr.js";
import {
  taskLogsGetRoute,
  taskLogsPostRoute,
} from "./routes/tasks/task-logs.js";
import { taskTurnsPostRoute } from "./routes/tasks/task-turns.js";
import { jobRunLogsRoute } from "./routes/tasks/job-run-logs.js";
import { taskPostRoute } from "./routes/tasks/task-post.js";
import { taskGroupRoute } from "./routes/tasks/task-group.js";
import {
  specTasksSyncRoute,
  specTasksReadyRoute,
  specTasksClaimRoute,
  specTasksCompleteRoute,
} from "./routes/spec-tasks/spec-tasks.js";
import { memoryRoute } from "./routes/memory/memory.js";
import { memoryBrowseRoutes } from "./routes/memory/memory-browse.js";
import { episodeRoute } from "./routes/memory/episode.js";
import { sessionSummaryRoute } from "./routes/memory/session-summary.js";
import { ingestRoute } from "./routes/ingest/ingest.js";
import { ingestGraphRoute } from "./routes/ingest/ingest-graph.js";
import { ingestStateRoute } from "./routes/ingest/ingest-state.js";
import { ingestDeltaRoute } from "./routes/ingest/ingest-delta.js";
import { eventPayloadRoute } from "./routes/ingest/event-payload.js";
import { embedRoute } from "./routes/ingest/embed.js";
import { reembedRoute } from "./routes/ingest/reembed.js";
import { onboardRoute } from "./routes/repos/onboard.js";
import { slackWebhookRoute } from "./routes/webhooks/webhook-slack.js";
import { incidentWebhookRoute } from "./routes/webhooks/webhook-incident.js";
import {
  webhookStatusRoute,
  webhookSecretRoute,
  webhookEnsureRoute,
} from "./routes/webhooks/webhook.js";
import { tokensRoute } from "./routes/tokens/tokens.js";
import { clusterAgentRegisterRoute } from "./routes/cluster-agents/register.js";
import { clusterAgentClaimRoute } from "./routes/cluster-agents/claim.js";
import { clusterAgentCatalogEventsRoute } from "./routes/cluster-agents/catalog-events.js";
import { clusterAgentCatalogStatusRoute } from "./routes/cluster-agents/catalog-status.js";
import { agentDefinitionUsageRoute } from "./routes/agent-definitions/usage.js";
import { orgAgentDefinitionsRoute } from "./routes/agent-definitions/org-list.js";
import { orgAgentDefinitionUpdateRoute } from "./routes/agent-definitions/org-update.js";
import { clusterAgentInstallRoutes } from "./routes/cluster-agents/install.js";
import { clusterAgentPauseRoute } from "./routes/cluster-agents/pause.js";
import { clusterAgentRestartRoute } from "./routes/cluster-agents/restart.js";
import { clusterAgentHeartbeatRoute } from "./routes/cluster-agents/heartbeat.js";
import { clusterAgentReleaseRoute } from "./routes/cluster-agents/release.js";
import { clusterAgentListRoute } from "./routes/cluster-agents/list.js";
import { darkFactoryRoute } from "./routes/dark-factory/dark-factory.js";
import {
  agentsGetRoute,
  agentsPostRoute,
  agentsPutRoute,
  agentsDeleteRoute,
} from "./routes/agent-definitions/agents.js";
import { usageRoute } from "./routes/analytics/usage.js";
import { analyticsRoute } from "./routes/analytics/analytics.js";
import { activityRoutes } from "./routes/analytics/activity.js";
import { analyticsOverviewRoute } from "./routes/analytics/spend.js";
import { spendWindowRoute } from "./routes/analytics/spend-window.js";
import { agentStatsRoute } from "./routes/analytics/agent-stats.js";
import { impactRoute } from "./routes/impact/impact.js";
import { impactBaseRoute } from "./routes/impact/impact-base.js";
import { traceRoute } from "./routes/trace/trace.js";
import { chunksRoute } from "./routes/repos/chunks.js";
import { searchContextRoute } from "./routes/context/search-context.js";
import { chunksPruneRoute } from "./routes/repos/chunks-prune.js";
import { stationDataRoutes } from "./routes/repos/station-data.js";
import { traceAdrsRoute } from "./routes/trace/trace-adrs.js";
import { traceSpecsRoute } from "./routes/trace/trace-specs.js";
import { featuresRoutes } from "./routes/features/features.js";
import { implementationLoopRoutes } from "./routes/backlog/backlog.js";
import { openApiJsonRoute, docsRoute } from "./routes/openapi/openapi.js";
import { githubCredentialsRoute } from "./routes/github-credentials/github-credentials.js";

type PoolGetter = () => Pool | null;

/** Every route the API serves, grouped by the thing it acts on. */
export function routeList(getPool: PoolGetter): ServerRoute[] {
  return [
    ...platformRoutes(getPool),
    ...repoRoutes(getPool),
    ...taskRoutes(getPool),
    ...memoryRoutes(getPool),
    ...ingestRoutes(getPool),
    ...webhookRoutes(getPool),
    ...clusterAgentRoutes(getPool),
    githubCredentialsRoute(getPool),
    ...agentDefinitionRoutes(getPool),
    ...analyticsRoutes(getPool),
    ...traceRoutes(),
  ];
}

/** The service describing and serving itself: health, model status, the binary, and the OpenAPI docs. */
function platformRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    healthzRoute(getPool),
    llmStatusRoute(getPool),
    distRoute(),
    openApiJsonRoute(getPool, routeList),
    docsRoute(getPool, routeList),
  ];
}

/** A repo and what Lore knows about it: its record, its settings, and the context and graph read off it. */
function repoRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    repoStatusRoute(getPool),
    reposRoute(getPool),
    repoRecordRoute(),
    ...orgSettingsRoutes(getPool),
    repoSettingsRoute(getPool),
    prStatusRoute(),
    pullFilesRoute(),
    contextRoute(getPool),
    ...chunkBrowseRoutes(getPool),
    graphRoute(getPool),
    onboardRoute(getPool),
    ...darkFactoryRoute(getPool),
  ];
}

/** Pipeline tasks and the assembly runs that execute them; the emitted order is the order the OpenAPI generator walks, so the two halves stay concatenated rather than interleaved. */
function taskRoutes(getPool: PoolGetter): ServerRoute[] {
  return [...taskRunRoutes(getPool), ...specTaskRoutes(getPool)];
}

/** One task: its record, the runs that executed it, and the logs those runs left behind. */
function taskRunRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    getTaskRoute(),
    listTasksRoute(),
    timelineRoute(getPool),
    taskRunsRoute(getPool),
    ...taskViewRoutes(getPool),
    ...assemblyLineRoutes(getPool),
    startRunRoute(),
    runReadRoute(getPool),
    runDodRoute(getPool),
    runStreamRoute(getPool),
    taskByPrRoute(getPool),
    taskLogsGetRoute(getPool),
    jobRunLogsRoute(),
    taskPostRoute(getPool),
    taskGroupRoute(getPool),
  ];
}

/** The spec-task DAG and the feature backlog above it, plus the transcript sinks a running node writes into. */
function specTaskRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    specTasksSyncRoute(getPool),
    specTasksReadyRoute(getPool),
    specTasksClaimRoute(getPool),
    specTasksCompleteRoute(getPool),
    taskLogsPostRoute(),
    taskTurnsPostRoute(getPool),
    ...featuresRoutes(getPool),
    ...implementationLoopRoutes(getPool),
  ];
}

/** Agent memory: entries, episodes, and the session summaries facts are extracted from. */
function memoryRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    memoryRoute(getPool),
    ...memoryBrowseRoutes(getPool),
    episodeRoute(getPool),
    sessionSummaryRoute(getPool),
  ];
}

/** Everything that writes knowledge in, plus the embedding call the writes depend on. */
function ingestRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    ingestRoute(getPool),
    ingestGraphRoute(getPool),
    ingestStateRoute(getPool),
    ingestDeltaRoute(getPool),
    eventPayloadRoute(getPool),
    embedRoute(),
    // The sweep is a write of knowledge (rows leave the store), not a graph read.
    chunksPruneRoute(getPool),
    reembedRoute(getPool),
  ];
}

/** Inbound from other systems, and the credentials that gate them. */
function webhookRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    slackWebhookRoute(getPool),
    incidentWebhookRoute(getPool),
    webhookStatusRoute(),
    webhookEnsureRoute(),
    webhookSecretRoute(),
    ...tokensRoute(getPool),
  ];
}

/** The pull-only dispatch surface: a cluster agent registers, claims, heartbeats and releases through here. */
function clusterAgentRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    clusterAgentRegisterRoute(getPool),
    clusterAgentClaimRoute(getPool),
    clusterAgentCatalogEventsRoute(getPool),
    ...clusterAgentInstallRoutes(),
    clusterAgentPauseRoute(getPool),
    clusterAgentRestartRoute(getPool),
    clusterAgentHeartbeatRoute(getPool),
    clusterAgentReleaseRoute(getPool),
    clusterAgentListRoute(getPool),
    clusterAgentCatalogStatusRoute(getPool),
  ];
}

/** The recipes a run resolves by name, read and edited here. */
function agentDefinitionRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    agentsGetRoute(getPool),
    agentDefinitionUsageRoute(getPool),
    orgAgentDefinitionsRoute(getPool),
    orgAgentDefinitionUpdateRoute(getPool),
    agentsPostRoute(getPool),
    agentsPutRoute(getPool),
    agentsDeleteRoute(getPool),
  ];
}

/** What the platform cost and what it did. */
function analyticsRoutes(getPool: PoolGetter): ServerRoute[] {
  return [
    usageRoute(getPool),
    analyticsRoute(getPool),
    ...activityRoutes(getPool),
    spendWindowRoute(getPool),
    analyticsOverviewRoute(getPool),
    agentStatsRoute(getPool),
  ];
}

/** The spec-traceability graph: impact, documents, and the chunks behind them. */
function traceRoutes(): ServerRoute[] {
  return [
    impactRoute(),
    impactBaseRoute(),
    traceRoute(),
    chunksRoute(),
    // The corpus search the MCP adapter proxies; without it lore_search_context can only grep the caller's checkout.
    searchContextRoute(),
    ...stationDataRoutes(),
    traceAdrsRoute(),
    traceSpecsRoute(),
  ];
}
