/**
 * The event-router's HTTP server (hapi): the one front door to
 * `pipeline.events`, the drain loop's consume endpoints, and the probe.
 *
 * `buildServer` does not listen, so tests drive it with `inject()`; `startServer`
 * is what boot calls. It registers NO signal handler — process lifecycle belongs
 * to one owner (index.ts), which needs the stop function rather than a competing
 * handler.
 */

import Hapi from "@hapi/hapi";
import { eventsRoute } from "./routes/events.js";
import { eventQueueRoutes } from "./routes/event-queue.js";
import { eventDeliveryRoutes } from "./routes/event-deliveries.js";
import { healthRoute } from "./routes/health.js";
import { pipeline, deliveries, clusterAgents } from "../kernel/queues.js";

// GitHub caps webhook payloads at 25 MB. Bound it there rather than at hapi's
// 1 MB default, which would reject the large push deliveries that work today.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function buildServer(opts: { port?: number } = {}): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  // A handler or auth throw otherwise becomes an anonymous 500 whose cause hapi
  // never prints — the shape that made #1319 undiagnosable. This channel fires
  // only for 500s carrying an error; deliberate non-500 refusals never reach it.
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
      // A THUNKED call, not a resolved repository: the pool does not exist when
      // the routes are described, and the lookup only runs for a bearer that is
      // not the ingest token — so the central cluster's reports never pay it.
      findByTokenHash: (hash) => clusterAgents().findByTokenHash(hash),
    }),
    ...eventQueueRoutes({
      queue: () => pipeline().eventQueue,
      bearerToken: process.env.LORE_INGEST_TOKEN,
    }),
    // Lazy for the same reason the queue's thunk is: the pool does not exist
    // when the routes are described.
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
