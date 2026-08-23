/**
 * The cluster agent's HTTP server (hapi): this cluster's Kubernetes surface,
 * and the probe.
 *
 * `buildServer` does not listen, so tests drive it with `inject()`, and it
 * builds no Kubernetes client — `clusterDeps` is resolved lazily on first use.
 */

import Hapi from "@hapi/hapi";
import { clusterRoutes } from "./routes/cluster.js";
import { healthRoute } from "./routes/health.js";
import { clusterDeps } from "../kernel/deps.js";

export function buildServer(opts: { port?: number } = {}): Hapi.Server {
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
    healthRoute(),
  ]);

  return server;
}

export async function startServer(port: number): Promise<() => Promise<void>> {
  const server = buildServer({ port });

  try {
    await server.start();
    console.log(`[cluster-agent] listening on :${port}/api/cluster`);

    return () => server.stop();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    if (e.code === "EADDRINUSE") {
      console.error(
        `[cluster-agent] port ${port} already in use — another instance is running. Exiting.`,
      );
    } else {
      console.error("[cluster-agent] server error:", err);
    }
    process.exit(1);
  }
}
