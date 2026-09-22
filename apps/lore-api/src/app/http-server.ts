import type { Pool } from "pg";
import { buildServer } from "./build-server.js";
import { shutdownOtel } from "../outbound/otel-init.js";
import { drainEventProxies } from "../transport/routes/event-reporter.js";
import { DEFAULT_DRAIN_TIMEOUT_MS } from "@re-cinq/lore-shared/project/events/event-tuning.js";
import { requiredPort } from "@re-cinq/lore-shared/lib/required-env.js";

/** Start the Lore API (/api/*); MCP proxies to these routes via buildServer factory. */
export async function startHttpServer(
  getPool: () => Pool | null,
): Promise<void> {
  const port = requiredPort(process.env, "PORT");
  const server = buildServer(getPool, port);

  // Flush telemetry on SIGTERM (was dropping on rollouts before #1051).
  process.on("SIGTERM", () => void shutdownGracefully(server, shutdownOtel));
  process.on("SIGINT", () => void shutdownGracefully(server, shutdownOtel));

  await server.start();
  console.log(`Lore API listening on :${port}`);
}

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

  await drainEvents(flushEvents);
  await flushTelemetry().catch((err) =>
    console.warn(`[otel] shutdown flush failed: ${(err as Error).message}`),
  );
}

/** Runs before the telemetry flush and swallows its own failure — a stuck drain must not cost the flush that follows it. */
async function drainEvents(
  flushEvents: (timeoutMs: number) => Promise<number>,
): Promise<void> {
  const undrained = await flushEvents(DEFAULT_DRAIN_TIMEOUT_MS).catch((err) => {
    console.warn(`[lore-api] event drain failed: ${(err as Error).message}`);

    return 0;
  });

  if (undrained > 0) {
    console.error(
      `[lore-api] exiting with ${undrained} undelivered event(s) — the reconcile pass is what re-emits them`,
    );
  }
}
