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
import { handleIngest } from "./ingest/ingest.js";
import { handleOnboard } from "./repos/onboard.js";
import { handleGetTask } from "./tasks/get-task.js";
import { handleListTasks } from "./tasks/list-tasks.js";
import { handleTaskPost } from "./tasks/task-post.js";
import { handleTaskTimeline } from "./tasks/task-timeline.js";
import { handleTaskByPr } from "./tasks/task-by-pr.js";
import { handleMemory } from "./memory/memory.js";
import { handleEpisode } from "./memory/episode.js";
import { handleSessionSummary } from "./memory/session-summary.js";
import { handleSlackWebhook } from "./webhooks/webhook-slack.js";
import { handleIncidentWebhook } from "./webhooks/webhook-incident.js";
import { handleTaskLogs, handleGetTaskLogs } from "./tasks/task-logs.js";
import { handleGetJobRunLogs } from "./tasks/job-run-logs.js";
import { handleTokens } from "./tokens/tokens.js";
import { handleDarkFactorySettingsRoute } from "./dark-factory/dark-factory.js";
import { handleAgentsRoute } from "./agent-definitions/agents.js";
import { handleImpactRoute } from "./impact/impact.js";
import { handleIngestGraphRoute } from "./ingest/ingest-graph.js";
import { handleWebhookStatus, handleWebhookEnsure, handleWebhookSecret } from "./webhooks/webhook.js";
import { handleTraceRoute } from "./trace/trace.js";
import { handleGlobalTraceSpecs } from "./trace/trace-specs.js";
import { handleFeaturesRoute } from "./features/features.js";

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
// /healthz and /dist/lore-code-trace/* are now native hapi routes (Phase 2).
const API_ROUTES: ApiRoute[] = [
  { match: exact("/api/ingest", "POST"), handle: handleIngest },
  { match: exact("/api/onboard", "POST"), handle: handleOnboard },
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
  { match: prefix("/api/task-logs", "GET"), handle: (req, res, pool) => handleGetTaskLogs(req, res, pool) },
  { match: prefix("/api/job-run-logs", "GET"), handle: (req, res) => handleGetJobRunLogs(req, res) },
  { match: exact("/api/webhook/incident", "POST"), handle: handleIncidentWebhook },
  { match: path((url) => url === "/api/tokens"), handle: handleTokens },
  { match: path((url) => /^\/api\/repos\/[^/]+\/[^/]+\/settings\/dark-factory(\?|$)/.test(url)), handle: handleDarkFactorySettingsRoute },
  { match: path((url) => /^\/api\/repos\/[^/]+\/[^/]+\/agent-definitions(\/[^/?]+)?(\?|$)/.test(url)), handle: handleAgentsRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/impact(\?|$)/, "POST"), handle: handleImpactRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/ingest-graph(\?|$)/, "POST"), handle: handleIngestGraphRoute },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/webhook\/ensure(\?|$)/, "POST"), handle: handleWebhookEnsure },
  { match: pattern(/^\/api\/repos\/[^/]+\/[^/]+\/webhook\/secret(\?|$)/, "GET"), handle: handleWebhookSecret },
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
