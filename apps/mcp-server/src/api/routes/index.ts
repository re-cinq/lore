/**
 * HTTP API router. Runs cross-cutting gates (rate limit + bearer-token
 * scope auth), then matches the request against an ordered route table
 * and delegates to the area handler. Handlers live in sibling modules;
 * this file owns only dispatch.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { json } from "./http.js";
import { rateLimit, getRequiredScope, validateClientToken, type RateBucket } from "./auth.js";
import { handleHealthz, handleRepoStatus } from "./health.js";
import { handleIngest, handleOnboard } from "./ingest.js";
import { handleContext } from "./context.js";
import { handleGraph } from "./graph.js";
import { handleGetTask, handleListTasks, handleTaskPost } from "./tasks.js";
import { handleTaskTimeline, handleTaskByPr } from "./task-timeline.js";
import { handleMemory, handleEpisode, handleSessionSummary } from "./memory.js";
import { handleSlackWebhook, handleIncidentWebhook } from "./webhooks.js";
import { handleTaskLogs, handleGetTaskLogs, handleGetJobRunLogs } from "./logs.js";
import { handleTokens } from "./tokens.js";
import { handleDarkFactorySettingsRoute } from "./dark-factory.js";
import { handleAgentsRoute } from "./agents.js";
import { handleCoverageRoute } from "./coverage.js";
import { handleTestReport } from "./test-report.js";
import { handleImpactRoute } from "./impact.js";
import { handleIngestGraphRoute } from "./ingest-graph.js";
import { handleWebhookStatus, handleWebhookEnsure } from "./webhook.js";
import { handleTraceRoute, handleGlobalTraceSpecs } from "./trace.js";
import { handleFeaturesRoute } from "./features.js";
import { handleDistRoute } from "./dist.js";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
) => Promise<void>;

type RouteMatcher = (url: string, method: string) => boolean;

interface ApiRoute {
  match: RouteMatcher;
  handle: RouteHandler;
}

const exact = (path: string, verb: string): RouteMatcher =>
  (url, method) => url === path && method === verb;
const prefix = (path: string, verb: string): RouteMatcher =>
  (url, method) => url.startsWith(path) && method === verb;
const pattern = (re: RegExp, verb: string): RouteMatcher =>
  (url, method) => re.test(url) && method === verb;
const path = (matcher: (url: string) => boolean): RouteMatcher =>
  (url) => matcher(url);

// Order matters: specific regex routes precede the broad /api/tasks prefix.
const API_ROUTES: ApiRoute[] = [
  { match: path((url) => url === "/healthz"), handle: handleHealthz },
  { match: prefix("/dist/lore-code-trace/", "GET"), handle: (req, res) => handleDistRoute(req, res) },
  { match: prefix("/api/repo-status", "GET"), handle: handleRepoStatus },
  { match: exact("/api/ingest", "POST"), handle: handleIngest },
  { match: exact("/api/onboard", "POST"), handle: handleOnboard },
  { match: prefix("/api/context", "GET"), handle: handleContext },
  { match: prefix("/api/graph", "GET"), handle: handleGraph },
  { match: prefix("/api/task/", "GET"), handle: (req, res) => handleGetTask(req, res) },
  { match: pattern(/^\/api\/tasks\/[^/]+\/timeline(\?|$)/, "GET"), handle: handleTaskTimeline },
  { match: pattern(/^\/api\/tasks\/by-pr\/[^/]+\/[^/]+\/[0-9]+(\?|$)/, "GET"), handle: handleTaskByPr },
  { match: prefix("/api/tasks", "GET"), handle: (req, res) => handleListTasks(req, res) },
  { match: exact("/api/task", "POST"), handle: handleTaskPost },
  { match: exact("/api/memory", "POST"), handle: handleMemory },
  { match: exact("/api/episode", "POST"), handle: handleEpisode },
  { match: exact("/api/session-summary", "POST"), handle: handleSessionSummary },
  { match: exact("/api/webhook/slack", "POST"), handle: handleSlackWebhook },
  { match: exact("/api/task-logs", "POST"), handle: (req, res) => handleTaskLogs(req, res) },
  { match: prefix("/api/task-logs", "GET"), handle: (req, res) => handleGetTaskLogs(req, res) },
  { match: prefix("/api/job-run-logs", "GET"), handle: (req, res) => handleGetJobRunLogs(req, res) },
  { match: exact("/api/webhook/incident", "POST"), handle: handleIncidentWebhook },
  { match: path((url) => url === "/api/tokens"), handle: handleTokens },
  { match: path((url) => /^\/api\/repos\/[^/]+\/[^/]+\/settings\/dark-factory(\?|$)/.test(url)), handle: handleDarkFactorySettingsRoute },
  { match: path((url) => /^\/api\/repos\/[^/]+\/[^/]+\/agent-definitions(\/[^/?]+)?(\?|$)/.test(url)), handle: handleAgentsRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/coverage(\?|$)/, "POST"), handle: handleCoverageRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/test-report(\?|$)/, "POST"), handle: handleTestReport },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/impact(\?|$)/, "POST"), handle: handleImpactRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/ingest-graph(\?|$)/, "POST"), handle: handleIngestGraphRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/webhook\/ensure(\?|$)/, "POST"), handle: handleWebhookEnsure },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/webhook(\?|$)/, "GET"), handle: handleWebhookStatus },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/trace\//, "GET"), handle: handleTraceRoute },
  { match: pattern(/^\/api\/trace\/specs(\?|$)/, "GET"), handle: handleGlobalTraceSpecs },
  { match: path((url) => /^\/api\/repos\/[^/]+\/[^/]+\/features(\/.*)?(\?|$)/.test(url)), handle: handleFeaturesRoute },
];

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "";

  // Rate limiting (healthz is exempt)
  if (url !== "/healthz") {
    const bucket: RateBucket = url.startsWith("/api/webhook/") ? "webhook"
      : (url === "/api/task" || url.startsWith("/api/task/") || url.startsWith("/api/tasks")) ? "task"
      : "default";
    if (!rateLimit(bucket)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" })
        .end(JSON.stringify({ error: "rate limit exceeded" }));
      return true;
    }
  }

  // Centralized auth — webhooks have their own HMAC auth, healthz is public
  const authExempt = url === "/healthz" || url.startsWith("/api/webhook/") || url.startsWith("/dist/");
  if (!authExempt) {
    const bearer = req.headers.authorization?.replace("Bearer ", "");
    if (!bearer) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const scope = getRequiredScope(url, method);
    const valid = await validateClientToken(pool, bearer, scope);
    if (!valid) {
      json(res, 403, { error: "insufficient scope" });
      return true;
    }
  }

  const route = API_ROUTES.find((r) => r.match(url, method));
  if (!route) return false;
  await route.handle(req, res, pool);
  return true;
}
