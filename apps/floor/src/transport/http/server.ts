import "@re-cinq/lore-shared/http/hapi-params.js";
/** Floor's HTTP server (hapi): webhook ingress, agent-telemetry sink, /healthz probe; routes in ./routes/. */

import Hapi from "@hapi/hapi";
import {
  logRequestErrors,
  startHapiServer,
} from "@re-cinq/lore-shared/http/server-boot.js";
import { registerBearerAuth } from "./auth.js";
import { registerRequestTracing } from "@re-cinq/lore-shared/http/tracing.js";
import { healthRoute } from "./routes/health.js";
import { agentEventsRoute } from "./routes/agent-events.js";
import { clusterAgents } from "../../outbound/queues.js";
import {
  agentConversationFetchRoute,
  agentConversationSaveRoute,
} from "./routes/agent-conversations.js";
import { agentLogsRoute } from "./routes/agent-logs.js";
import { agentEventsHistoryRoute } from "./routes/agent-events-history.js";
import { agentTurnsHistoryRoute } from "./routes/agent-turns-history.js";
import { agentTurnsByTaskRoute } from "./routes/agent-turns-by-task.js";
import { assemblyLineDefinitionsRoute } from "./routes/assembly-line-definitions.js";
import {
  assemblyRunReadRoute,
  legacyAssemblyLineReadRoute,
  assemblyLineCatalogRoute,
} from "./routes/assembly-line-reads.js";
import { ciIngestRoute } from "./routes/ci-ingest.js";
import { ciTestsRoute, type CiTestsRouteDeps } from "./routes/ci-tests.js";
import { reviewStartRoute } from "./routes/review-start.js";
import type {
  PodLogSource,
  PodLogArchive,
  LiveReadable,
} from "../../work/station/agent-pod-logs.js";

// GitHub caps payloads at 25 MB; bound generously to support large push deliveries.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** The read side: an assembly run's events, turns, definitions and catalog. */
const RUN_READ_ROUTES: Hapi.ServerRoute[] = [
  agentConversationSaveRoute,
  agentConversationFetchRoute,
  agentEventsHistoryRoute(),
  agentTurnsHistoryRoute(),
  agentTurnsByTaskRoute(),
  assemblyLineDefinitionsRoute(),
  assemblyRunReadRoute(),
  legacyAssemblyLineReadRoute(),
  assemblyLineCatalogRoute(),
];

interface FloorServerOptions extends CiTestsRouteDeps {
  getJobStatus: () => unknown;
  podLogSource?: PodLogSource;
  podLogArchive?: PodLogArchive;
  liveReadable?: LiveReadable;
}

export function buildServer(
  opts: FloorServerOptions & { port?: number },
): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  registerRequestTracing(server, { tracerName: "lore.floor.http" });
  registerBearerAuth(server);
  logRequestErrors(server);
  server.route(floorRoutes(opts));

  return server;
}

/** Everything the Floor serves. Cluster-agent tokens open the telemetry sink, which is what lets a satellite report cost and run-viz events without holding the bus secret. */
function floorRoutes(opts: FloorServerOptions): Hapi.ServerRoute[] {
  return [
    healthRoute(opts.getJobStatus),
    agentEventsRoute({
      findByTokenHash: (hash) => clusterAgents().findByTokenHash(hash),
    }),
    agentLogsRoute(opts.podLogSource, opts.podLogArchive, opts.liveReadable),
    ...RUN_READ_ROUTES,
    ...ingestRoutes({
      testReports: opts.testReports,
      defaultBranch: opts.defaultBranch,
    }),
  ];
}

/** The write side: what CI and the review choreography post in. */
function ingestRoutes(deps: CiTestsRouteDeps): Hapi.ServerRoute[] {
  return [ciIngestRoute, ciTestsRoute(deps), reviewStartRoute];
}

/** Start the HTTP server and return how to stop it. No signal handlers: process lifecycle owns single exit (index.ts). */
export function startHealthServer(
  port: number,
  getJobStatus: () => unknown,
): Promise<() => Promise<void>> {
  return startHapiServer(buildServer({ getJobStatus, port }), {
    label: "floor",
    port,
    ready: `Health server on :${port}/healthz`,
  });
}
