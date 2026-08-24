/**
 * `POST /api/stations/{name}` — run one station, return what it reported.
 *
 * The fourth execution form of a Station (ADR-024): not a pod dispatched as an
 * assembly-line node, not a local worktree, not a person behind a route — an
 * HTTP handler in a service that sits next to the data. A cron sweep needs none
 * of what a pod gives a line node (workspace clone, per-node identity, a
 * deadline), and paid for all of it.
 *
 * Synchronous on purpose. The caller is the Floor's scheduler, which already
 * opens a `pipeline.job_runs` row and wants the summary to close it with. A
 * station that grows long enough to make that wrong is the signal to give it an
 * async form, not a reason to build one now.
 */

import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

/** A station: no input, one summary line. Exactly the shape the jobs that move
 *  here already had (`(): Promise<string>`), which is why moving them is a move. */
export type Station = () => Promise<string>;

export type StationRegistry = ReadonlyMap<string, Station>;

export interface StationsRouteDeps {
  /** A thunk: the registry closes over a pool that does not exist at route-build time. */
  registry: () => StationRegistry;
  bearerToken?: string;
}

export function stationsRoute(deps: StationsRouteDeps): ServerRoute {
  // Which stations are mid-run. The Floor is a single replica today, so this is
  // insurance rather than load-bearing — but it is the guard that makes a
  // second Floor replica, or a retried tick, safe rather than a double sweep.
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
        // `finally`, not the success path: a station that threw must not stay
        // latched, or one bad run wedges it until the process restarts.
        running.delete(name);
      }
    },
  };
}
