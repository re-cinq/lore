// POST /api/stations/{name} — the fourth Station execution form (ADR-024): a sync HTTP handler beside the data, so the Floor's scheduler can close its job_runs row with the summary.

import type { StationRegistry } from "../../domain/station.js";
import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import Boom from "@hapi/boom";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { errorMessage } from "@re-cinq/lore-shared";

export interface StationsRouteDeps {
  /** A thunk: the registry closes over a pool that does not exist at route-build time. */
  registry: () => StationRegistry;
  bearerToken?: string;
}

// The named station, if it exists and is not already mid-run. The 404 lists what the registry does answer to, because the commonest cause is a blueprint naming a station this deployment does not carry.
function availableStation(
  deps: StationsRouteDeps,
  running: Set<string>,
  name: string,
) {
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

  return station;
}

// Runs one named station, once. The 409 is the point of `running`: a tick that arrives before the last one finished is refused rather than queued, because two sweeps of the same station would each act on what the other is mid-way through. Released in `finally`, not on success — a throw must not leave the station latched.
function runStationHandler(
  deps: StationsRouteDeps,
  running: Set<string>,
): Lifecycle.Method {
  return async (request, h) => {
    enforceBearer(request.headers, deps.bearerToken);
    const name = request.params.name;
    const station = availableStation(deps, running, name);

    running.add(name);

    try {
      return h.response({ job: name, summary: await station() }).code(200);
    } catch (err) {
      request.log(["error", "station"], errorMessage(err));
      throw Boom.internal();
    } finally {
      running.delete(name);
    }
  };
}

export function stationsRoute(deps: StationsRouteDeps): ServerRoute {
  // Tracks stations mid-run; the Floor is single-replica today so this is insurance, but it's what makes a second replica or a retried tick safe rather than a double sweep.
  const running = new Set<string>();

  return {
    method: "POST",
    path: "/api/stations/{name}",
    options: { auth: false },
    handler: runStationHandler(deps, running),
  };
}
