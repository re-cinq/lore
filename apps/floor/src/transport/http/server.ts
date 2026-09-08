import "@re-cinq/lore-shared/http/hapi-params.js";
/** Floor's HTTP server (hapi): webhook ingress, agent-telemetry sink, /healthz probe; routes in ./routes/. */

import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "./auth.js";
import { registerRequestTracing } from "./tracing.js";
import { healthRoute } from "./routes/health.js";
import { agentEventsRoute } from "./routes/agent-events.js";
import { clusterAgents } from "../../outbound/queues.js";
import {
  agentConversationFetchRoute,
  agentConversationSaveRoute,
} from "./routes/agent-conversations.js";
import { agentLogsRoute } from "./routes/agent-logs.js";
import { agentEventsStreamRoute } from "./routes/agent-events-stream.js";
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
import { ciTestsRoute } from "./routes/ci-tests.js";
import { reviewStartRoute } from "./routes/review-start.js";
import type {
  PodLogSource,
  PodLogArchive,
} from "../../work/station/agent-pod-logs.js";

// GitHub caps payloads at 25 MB; bound generously to support large push deliveries.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export interface FloorServerOptions {
  getJobStatus: () => unknown;
  port?: number;
  podLogSource?: PodLogSource;
  podLogArchive?: PodLogArchive;
}

/** The error channel fires only for 500s (#1319). `request.info.id` is logged so the line joins the span the tracing plugin opened for the same request — without it a stack trace has no request to belong to. */
function logServerErrors(server: Hapi.Server): void {
  server.events.on({ name: "request", channels: "error" }, (request, event) => {
    const err = event.error;
    const detail = err instanceof Error ? (err.stack ?? err.message) : `${err}`;

    console.error(
      `[http] ${request.method.toUpperCase()} ${request.path} 500 (${request.info.id}): ${detail}`,
    );
  });
}

/** The read surface the run visualization and the task pages pull from — conversations, telemetry, and the SSE stream that carries a run while it is still going. */
function agentReadRoutes(): Hapi.ServerRoute[] {
  return [
    agentConversationSaveRoute,
    agentConversationFetchRoute,
    agentEventsStreamRoute(),
    agentEventsHistoryRoute(),
    agentTurnsHistoryRoute(),
    agentTurnsByTaskRoute(),
  ];
}

/** Definition + run reads, including the legacy path kept alive for links minted before the assembly-run rename. */
function assemblyLineRoutes(): Hapi.ServerRoute[] {
  return [
    assemblyLineDefinitionsRoute(),
    assemblyRunReadRoute(),
    legacyAssemblyLineReadRoute(),
    assemblyLineCatalogRoute(),
  ];
}

/** Everything the Floor serves. Cluster-agent tokens open the telemetry sink, which is what lets a satellite report cost and run-viz events without holding the bus secret. */
function floorRoutes(opts: FloorServerOptions): Hapi.ServerRoute[] {
  return [
    healthRoute(opts.getJobStatus),
    agentEventsRoute({
      findByTokenHash: (hash) => clusterAgents().findByTokenHash(hash),
    }),
    ...agentReadRoutes(),
    ...assemblyLineRoutes(),
    agentLogsRoute(opts.podLogSource, opts.podLogArchive),
    ciIngestRoute,
    ciTestsRoute,
    reviewStartRoute,
  ];
}

export function buildServer(opts: FloorServerOptions): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  registerRequestTracing(server);
  registerBearerAuth(server);
  logServerErrors(server);
  server.route(floorRoutes(opts));

  return server;
}

/** A Floor that cannot bind its port has nothing to do, so both cases end the process — but a taken port means a second instance is already serving, which is worth saying plainly instead of dumping a stack. */
function exitOnBindFailure(port: number, err: unknown): never {
  const e = err as NodeJS.ErrnoException;

  const portInUse = e.code === "EADDRINUSE";

  if (portInUse) {
    console.error(
      `[floor] Health server port ${port} already in use — another agent instance is running. Exiting.`,
    );
  }

  if (!portInUse) {
    console.error("[floor] Health server error:", err);
  }
  process.exit(1);
}

/** Start the HTTP server and return how to stop it. No signal handlers: process lifecycle owns single exit (index.ts). */
export async function startHealthServer(
  port: number,
  getJobStatus: () => unknown,
): Promise<() => Promise<void>> {
  const server = buildServer({ getJobStatus, port });

  try {
    await server.start();
    console.log(`[floor] Health server on :${port}/healthz`);

    return () => server.stop();
  } catch (err) {
    return exitOnBindFailure(port, err);
  }
}
