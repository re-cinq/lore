// POST /api/stations/{name} — the fourth Station execution form (ADR-024): a sync HTTP handler beside the data, so the Floor's scheduler can close its job_runs row with the summary.

import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

// A station: no input, one summary line — the exact shape the jobs moving here already had.
export type Station = () => Promise<string>;

export type StationRegistry = ReadonlyMap<string, Station>;

export interface StationsRouteDeps {
  /** A thunk: the registry closes over a pool that does not exist at route-build time. */
  registry: () => StationRegistry;
  bearerToken?: string;
}

export function stationsRoute(deps: StationsRouteDeps): ServerRoute {
  // Tracks stations mid-run; the Floor is single-replica today so this is insurance, but it's what makes a second replica or a retried tick safe rather than a double sweep.
  const running = new Set<string>();

  return {
    method: "POST",
    path: "/api/stations/{name}",
    options: { auth: false },
    handler: async (request, h) => {
      enforceBearer(request.headers, deps.bearerToken);

      const name = request.params.name;
      const station = deps.registry().get(name);

      enforceTrue(
        station,
        apiError(404),
        `no station named "${name}" — the registry answers to: ${[...deps.registry().keys()].join(", ")}`,
      );
      enforceTrue(
        !running.has(name),
        apiError(409),
        `station "${name}" is already running — a tick arrived before the last one finished`,
      );

      running.add(name);

      try {
        return h.response({ summary: await station() }).code(200);
      } finally {
        // finally, not the success path — a throw must not leave the station latched.
        running.delete(name);
      }
    },
  };
}
