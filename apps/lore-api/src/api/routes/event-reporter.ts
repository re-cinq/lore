// Where a lore-api route reports the events it produces.
//
// Built from the pool the SERVER injected, not from a module singleton: routes
// here receive `getPool` from `buildServer`, and reaching around it for an
// ambient pool is what made these routes demand a database in tests that had
// deliberately supplied their own.
//
// The pool is resolved lazily — when `EVENT_ROUTER_URL` names a router
// (ADR-044) it is never touched at all.

import { selectEventReporter } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import { PgEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-pg.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";

/** Report through the router, or through this pool when no router is configured. */
export function eventReporterFor(pool: Pool | null): EventReporter {
  return selectEventReporter({
    local: () => {
      enforceTrue(
        pool,
        Error,
        "no database pool: cannot report the event to its assembly line",
      );

      return new PgEventQueue(pool);
    },
  });
}
