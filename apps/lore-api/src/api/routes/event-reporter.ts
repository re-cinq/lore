// Where a lore-api route reports the events it produces.
//
// Built from the pool the SERVER injected, not from a module singleton: routes
// here receive `getPool` from `buildServer`, and reaching around it for an
// ambient pool is what made these routes demand a database in tests that had
// deliberately supplied their own.
//
// The pool is resolved lazily — when `EVENT_ROUTER_URL` names a router
// (ADR-044) it is never touched at all.

import { selectEventProxy } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import { PgEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-pg.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";

/**
 * ONE proxy per pool, memoized.
 *
 * The queue is the proxy's own state, so building a fresh one per call would
 * make every `emit` land in a queue nobody drains — which is why this is a
 * cache and not a factory, even though the previous reporter could be. Keyed by
 * the pool the SERVER injected rather than a module singleton, because tests
 * supply their own and a shared instance would leak one suite's queue into the
 * next.
 *
 * Started on construction: a proxy nobody starts never drains.
 */
const proxies = new Map<Pool | null, EventProxy>();

export function eventProxyFor(pool: Pool | null): EventProxy {
  const existing = proxies.get(pool);

  if (existing) {
    return existing;
  }
  const proxy = selectEventProxy({
    local: () => {
      enforceTrue(
        pool,
        Error,
        "no database pool: cannot report the event to its assembly line",
      );

      return new PgEventQueue(pool);
    },
  });

  proxies.set(pool, proxy);
  void proxy.start();

  return proxy;
}

/**
 * Report through the router, or through this pool when no router is configured.
 *
 * `insert`, synchronous and throwing: the feature routes turn a failed report
 * into a 500 rather than a 202 that claims work started. A fire-and-forget
 * trigger reaches for `eventProxyFor(pool).emit` instead.
 */
export function eventReporterFor(pool: Pool | null): EventReporter {
  return eventProxyFor(pool);
}

/** Drain every proxy this process built. Returns what it could not deliver. */
export async function drainEventProxies(timeoutMs: number): Promise<number> {
  const remaining = await Promise.all(
    [...proxies.values()].map((proxy) => proxy.stop(timeoutMs)),
  );

  return remaining.reduce((total, count) => total + count, 0);
}
