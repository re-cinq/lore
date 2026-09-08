import "@re-cinq/lore-shared/http/hapi-params.js";
// The stations service's hapi server: one route to run a station by name, plus the health probe. buildServer doesn't listen (tests use inject()); process lifecycle belongs solely to index.ts.

import Hapi from "@hapi/hapi";
import {
  logRequestErrors,
  startHapiServer,
} from "@re-cinq/lore-shared/http/server-boot.js";
import { stationsRoute } from "./routes/stations.js";
import { dbHealthRoute } from "@re-cinq/lore-shared/http/db-health-route.js";
import { serviceStations } from "../events/runner/service-stations.js";
import { stationHost } from "../events/runner/station-host.js";

export function buildServer(opts: { port?: number } = {}): Hapi.Server {
  const server = Hapi.server({ port: opts.port ?? 0, host: "0.0.0.0" });

  logRequestErrors(server);

  server.route([
    stationsRoute({
      registry: () => serviceStations(stationHost()),
      bearerToken: process.env.LORE_INGEST_TOKEN,
    }),
    dbHealthRoute(),
  ]);

  return server;
}

export function startServer(port: number): Promise<() => Promise<void>> {
  const stations = [...serviceStations(stationHost()).keys()].join(", ");

  return startHapiServer(buildServer({ port }), {
    label: "stations",
    port,
    ready: `listening on :${port} — ${stations}`,
  });
}
