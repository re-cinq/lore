/** HTTP server (hapi): front door to pipeline.events + drain consume endpoints + health probe. */

import Hapi from "@hapi/hapi";
import { eventsRoute } from "./routes/events.js";
import { eventQueueRoutes } from "./routes/event-queue.js";
import { eventDeliveryRoutes } from "./routes/event-deliveries.js";
import { healthRoute } from "./routes/health.js";
import { pipeline, deliveries, clusterAgents } from "../kernel/queues.js";

// GitHub allows 25 MB; hapi default 1 MB would reject large push deliveries.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function buildServer(opts: { port?: number } = {}): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  // Log handler/auth errors: throws become anonymous 500s (#1319), channel fires for 500 + error.
  server.events.on({ name: "request", channels: "error" }, (request, event) => {
    const err = event.error;
    const detail = err instanceof Error ? (err.stack ?? err.message) : `${err}`;

    console.error(
      `[http] ${request.method.toUpperCase()} ${request.path} 500 (${request.info.id}): ${detail}`,
    );
  });

  server.route([
    eventsRoute({
      insert: (event) => pipeline().eventQueue.insert(event),
      webhookSecret: process.env.LORE_WEBHOOK_SECRET,
      bearerToken: process.env.LORE_INGEST_TOKEN,
      // Thunk: pool doesn't exist at describe time; lookup only for non-ingest bearer.
      findByTokenHash: (hash) => clusterAgents().findByTokenHash(hash),
    }),
    ...eventQueueRoutes({
      queue: () => pipeline().eventQueue,
      bearerToken: process.env.LORE_INGEST_TOKEN,
    }),
    // Lazy thunk: pool doesn't exist at describe time.
    ...eventDeliveryRoutes({
      deliveries: () => deliveries(),
      bearerToken: process.env.LORE_INGEST_TOKEN,
    }),
    healthRoute(),
  ]);

  return server;
}

export async function startServer(port: number): Promise<() => Promise<void>> {
  const server = buildServer({ port });

  try {
    await server.start();
    console.log(`[event-router] listening on :${port} (/api/events, /healthz)`);

    return () => server.stop();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    const failureLog =
      e.code === "EADDRINUSE"
        ? [
            `[event-router] port ${port} already in use — another instance is running. Exiting.`,
          ]
        : ["[event-router] server error:", err];

    console.error(...failureLog);
    process.exit(1);
  }
}
