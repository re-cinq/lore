// The stations service's hapi server: one route to run a station by name, plus the health probe. buildServer doesn't listen (tests use inject()); process lifecycle belongs solely to index.ts.

import Hapi from "@hapi/hapi";
import { stationsRoute } from "./routes/stations.js";
import { healthRoute } from "./routes/health.js";
import { serviceStations } from "../kernel/service-stations.js";
import { stationHost } from "../kernel/station-host.js";

export function buildServer(opts: { port?: number } = {}): Hapi.Server {
  const server = Hapi.server({ port: opts.port ?? 0, host: "0.0.0.0" });

  // Logs handler throws with their cause (#1319 was undiagnosable without this); deliberate non-500 refusals never reach this channel.
  server.events.on({ name: "request", channels: "error" }, (request, event) => {
    const err = event.error;
    const detail = err instanceof Error ? (err.stack ?? err.message) : `${err}`;

    console.error(
      `[http] ${request.method.toUpperCase()} ${request.path} 500 (${request.info.id}): ${detail}`,
    );
  });

  server.route([
    stationsRoute({
      registry: () => serviceStations(stationHost()),
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
    console.log(
      `[stations] listening on :${port} — ${[...serviceStations(stationHost()).keys()].join(", ")}`,
    );

    return () => server.stop();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    const failureLog =
      e.code === "EADDRINUSE"
        ? [
            `[stations] port ${port} already in use — another instance is running. Exiting.`,
          ]
        : ["[stations] server error:", err];

    console.error(...failureLog);
    process.exit(1);
  }
}
