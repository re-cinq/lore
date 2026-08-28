import type { Pool } from "pg";
import { buildServer } from "./build-server.js";
import { shutdownOtel } from "../platform/otel-init.js";
import { drainEventProxies } from "../api/routes/event-reporter.js";

/**
 * Start the Lore API (/api/*) on the configured PORT. A plain HTTPS REST
 * backend; the MCP protocol is served separately by the local stdio adapter
 * (@re-cinq/lore-mcp), which proxies to these routes. Construction (routes and
 * plugins) lives in `buildServer` — the one factory shared with the tests.
 */
export async function startHttpServer(
  getPool: () => Pool | null,
): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);
  const server = buildServer(getPool, port);

  // SIGTERM used to stop the server and nothing else, so every rollout dropped
  // the last span and metric batch — the telemetry from the final minute of a pod
  // that was, by definition, being replaced (#1051).
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

/**
 * Drain, then flush. Exported so the ordering and the failure handling are
 * testable without raising a real signal at the test runner.
 *
 * Both steps are best-effort and independent: a server that will not stop is
 * exactly when the last telemetry batch is most worth having, and a failed export
 * (an unauthed environment has no project id) must not turn a clean shutdown into
 * a SIGKILL.
 */
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

  // After the server stops, before telemetry flushes: an event produced by an
  // in-flight request has to reach the queue before the queue is drained, and
  // the queue is in memory — nothing awaited an event flush before this.
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
