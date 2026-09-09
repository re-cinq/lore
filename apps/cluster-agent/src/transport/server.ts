import "@re-cinq/lore-shared/http/hapi-params.js";
// The cluster agent's HTTP server (hapi): this cluster's Kubernetes surface, and the probe. `buildServer` does not listen (tests use `inject()`) and builds no Kubernetes client until first use.

import Hapi from "@hapi/hapi";
import {
  logRequestErrors,
  startHapiServer,
} from "@re-cinq/lore-shared/http/server-boot.js";
import { agentEventsRoutes } from "./routes/agent-events.js";
import { clusterRoutes } from "./routes/cluster.js";
import { healthRoute } from "./routes/health.js";
import { clusterDeps } from "../outbound/deps.js";
import type { AgentEventsDeps } from "./routes/agent-events.js";

export interface ServerOpts {
  port?: number;
  /** Wires the agent-telemetry relay; absent, the route is not mounted — a cluster with nowhere to forward telemetry should 404 rather than drop the batch. */
  agentEvents?: AgentEventsDeps;
}

export function buildServer(opts: ServerOpts = {}): Hapi.Server {
  const server = Hapi.server({ port: opts.port ?? 0, host: "0.0.0.0" });

  logRequestErrors(server);

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

export function startServer(
  port: number,
  agentEvents?: AgentEventsDeps,
): Promise<() => Promise<void>> {
  return startHapiServer(buildServer({ port, agentEvents }), {
    label: "cluster-agent",
    port,
    ready: `listening on :${port}/api/cluster`,
  });
}
