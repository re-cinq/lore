// The cluster agent's HTTP server (hapi): this cluster's Kubernetes surface, and the probe. `buildServer` does not listen (tests use `inject()`) and builds no Kubernetes client until first use.

import Hapi from "@hapi/hapi";
import { agentEventsRoutes } from "./routes/agent-events.js";
import { clusterRoutes } from "./routes/cluster.js";
import { healthRoute } from "./routes/health.js";
import { clusterDeps } from "../kernel/deps.js";
import type { AgentEventsDeps } from "./routes/agent-events.js";

export interface ServerOpts {
  port?: number;
  /** Wires the agent-telemetry relay; absent, the route is not mounted — a cluster with nowhere to forward telemetry should 404 rather than drop the batch. */
  agentEvents?: AgentEventsDeps;
}

export function buildServer(opts: ServerOpts = {}): Hapi.Server {
  const server = Hapi.server({ port: opts.port ?? 0, host: "0.0.0.0" });

  server.events.on({ name: "request", channels: "error" }, (request, event) => {
    const err = event.error;
    const detail = err instanceof Error ? (err.stack ?? err.message) : `${err}`;

    console.error(
      `[http] ${request.method.toUpperCase()} ${request.path} 500 (${request.info.id}): ${detail}`,
    );
  });

  server.route([
    ...clusterRoutes({
      deps: clusterDeps,
      bearerToken: process.env.LORE_INGEST_TOKEN,
    }),
    ...(opts.agentEvents ? agentEventsRoutes(opts.agentEvents) : []),
    healthRoute(),
  ]);

  return server;
}

export async function startServer(
  port: number,
  agentEvents?: AgentEventsDeps,
): Promise<() => Promise<void>> {
  const server = buildServer({ port, agentEvents });

  try {
    await server.start();
    console.log(`[cluster-agent] listening on :${port}/api/cluster`);

    return () => server.stop();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    const failureLog =
      e.code === "EADDRINUSE"
        ? [
            `[cluster-agent] port ${port} already in use — another instance is running. Exiting.`,
          ]
        : ["[cluster-agent] server error:", err];

    console.error(...failureLog);
    process.exit(1);
  }
}
