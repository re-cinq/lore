import type { Pool } from "pg";
import { buildServer } from "./build-server.js";
import { shutdownOtel } from "../platform/otel-init.js";
import { drainEventProxies } from "../api/routes/event-reporter.js";

/** Start the Lore API (/api/*); MCP proxies to these routes via buildServer factory. */
export async function startHttpServer(
  getPool: () => Pool | null,
): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);
  const server = buildServer(getPool, port);

  // Flush telemetry on SIGTERM (was dropping on rollouts before #1051).
  process.on("SIGTERM", () => void shutdownGracefully(server, shutdownOtel));
  process.on("SIGINT", () => void shutdownGracefully(server, shutdownOtel));

  await server.start();
  console.log(`Lore API listening on :${port}`);
}

/** How long shutdown waits for the event queue to drain. */
const EVENT_DRAIN_TIMEOUT_MS = 5_000;

/** What `shutdownGracefully` needs of the server — `Server` satisfies it. */
export interface Stoppable {
  stop(): Promise<void>;
}

/** Drain queued events, then flush telemetry; testable without raising signals. */
export async function shutdownGracefully(
  server: Stoppable,
  flushTelemetry: () => Promise<void>,
  flushEvents: (timeoutMs: number) => Promise<number> = drainEventProxies,
): Promise<void> {
  await server
    .stop()
    .catch((err) =>
      console.warn(`[lore-api] server stop failed: ${(err as Error).message}`),
    );

  // Drain queued events before telemetry flush (in-flight events must reach queue before drain).
  const undrained = await flushEvents(EVENT_DRAIN_TIMEOUT_MS).catch((err) => {
    console.warn(`[lore-api] event drain failed: ${(err as Error).message}`);

    return 0;
  });

  if (undrained > 0) {
    console.error(
      `[lore-api] exiting with ${undrained} undelivered event(s) — the reconcile pass is what re-emits them`,
    );
  }
  await flushTelemetry().catch((err) =>
    console.warn(`[otel] shutdown flush failed: ${(err as Error).message}`),
  );
}
