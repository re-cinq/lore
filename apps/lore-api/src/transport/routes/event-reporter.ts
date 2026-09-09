// Event reporters: built from injected pool, not module singleton; lazy resolution per ADR-044.

import { selectEventProxy } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import { PgEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-pg.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";

/** One proxy per pool, memoized; started on construction so queues drain. */
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

/** Report through router or pool; synchronous and throwing for 202-vs-500 semantics. */
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
