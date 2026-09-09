import "@re-cinq/lore-shared/http/hapi-params.js";
/** HTTP server (hapi): front door to pipeline.events + the delivery endpoints subscribers drain through + health probe. */

import Hapi from "@hapi/hapi";
import {
  logRequestErrors,
  startHapiServer,
} from "@re-cinq/lore-shared/http/server-boot.js";
import { eventsRoute } from "./routes/events.js";
import { eventDeliveryRoutes } from "./routes/event-deliveries.js";
import { dbHealthRoute } from "@re-cinq/lore-shared/http/db-health-route.js";
import { pipeline, deliveries, clusterAgents } from "../outbound/queues.js";

// GitHub allows 25 MB; hapi default 1 MB would reject large push deliveries.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

// Every route this server serves. The repository accessors are THUNKS throughout: the pool does not exist at describe time, so binding them eagerly would build a server that cannot be constructed in a test.
function allRoutes(): Hapi.ServerRoute[] {
  return [
    eventsRoute({
      insert: (event) => pipeline().eventReporter.insert(event),
      webhookSecret: process.env.LORE_WEBHOOK_SECRET,
      bearerToken: process.env.LORE_INGEST_TOKEN,
      findByTokenHash: (hash) => clusterAgents().findByTokenHash(hash),
    }),
    ...eventDeliveryRoutes({
      deliveries: () => deliveries(),
      bearerToken: process.env.LORE_INGEST_TOKEN,
    }),
    dbHealthRoute(),
  ];
}

export function buildServer(opts: { port?: number } = {}): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  logRequestErrors(server);

  server.route(allRoutes());

  return server;
}

export function startServer(port: number): Promise<() => Promise<void>> {
  return startHapiServer(buildServer({ port }), {
    label: "event-router",
    port,
    ready: `listening on :${port} (/api/events, /healthz)`,
  });
}
