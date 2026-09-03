/** Floor's HTTP server (hapi): webhook ingress, agent-telemetry sink, /healthz probe; routes in ./routes/. */

import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "./auth.js";
import { registerRequestTracing } from "./tracing.js";
import { healthRoute } from "./routes/health.js";
import { agentEventsRoute } from "./routes/agent-events.js";
import { clusterAgents } from "../../kernel/queues.js";
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
import { githubWebhookRoute } from "./routes/github-webhook.js";
import { ciIngestRoute } from "./routes/ci-ingest.js";
import { ciTestsRoute } from "./routes/ci-tests.js";
import { reviewStartRoute } from "./routes/review-start.js";
import type {
  PodLogSource,
  PodLogArchive,
} from "../../jobs/station/agent-pod-logs.js";

// GitHub caps payloads at 25 MB; bound generously to support large push deliveries.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function buildServer(opts: {
  getJobStatus: () => unknown;
  port?: number;
  podLogSource?: PodLogSource;
  podLogArchive?: PodLogArchive;
}): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  registerRequestTracing(server);
  registerBearerAuth(server);
  // Error logging (#1319): error channel fires only for 500s; join request.info.id to link span.
  server.events.on({ name: "request", channels: "error" }, (request, event) => {
    const err = event.error;
    const detail = err instanceof Error ? (err.stack ?? err.message) : `${err}`;

    console.error(
      `[http] ${request.method.toUpperCase()} ${request.path} 500 (${request.info.id}): ${detail}`,
    );
  });
  server.route([
    healthRoute(opts.getJobStatus),
    // Cluster-agent tokens open telemetry sink; satellites report cost + run-viz without bus secret.
    agentEventsRoute({
      findByTokenHash: (hash) => clusterAgents().findByTokenHash(hash),
    }),
    agentConversationSaveRoute,
    agentConversationFetchRoute,
    agentEventsStreamRoute(),
    agentEventsHistoryRoute(),
    agentTurnsHistoryRoute(),
    agentTurnsByTaskRoute(),
    assemblyLineDefinitionsRoute(),
    assemblyRunReadRoute(),
    legacyAssemblyLineReadRoute(),
    assemblyLineCatalogRoute(),
    agentLogsRoute(opts.podLogSource, opts.podLogArchive),
    githubWebhookRoute,
    ciIngestRoute,
    ciTestsRoute,
    reviewStartRoute,
  ]);

  return server;
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
}
