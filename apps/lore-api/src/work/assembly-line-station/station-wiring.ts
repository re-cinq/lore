// The production wiring of the live socket's run channel: the Postgres ports, the GitHub PR read, the process-wide notifier and the token verifier, all resolved from the pool the first time a channel opens, since the pool is created after the server is built.

import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { PgAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-pg.js";
import { PgTaskEvents } from "@re-cinq/lore-shared/project/task-events/task-events-pg.js";
import { fetchPrStatus } from "../../outbound/github-client.js";
import { liveTokenVerifier } from "./live-tokens.js";
import { RunFeedRegistry } from "./run-feed.js";
import { pgRunNotifier } from "./run-notify-hub.js";
import type { RunChannelDeps } from "./run-channel.js";

/** Run-channel dependencies bound to whatever pool exists when a channel opens; without one the open fails, which the socket reports as a server close. */
export function runChannelDepsFromPool(
  getPool: () => Pool | null,
): RunChannelDeps {
  let bound: RunChannelDeps | undefined;
  const resolve = (): RunChannelDeps => {
    if (bound) {
      return bound;
    }
    const pool = getPool();

    enforceTrue(pool !== null, Error, "database unavailable");
    bound = bind(pool);

    return bound;
  };

  return {
    verifyToken: (token, claim) => resolve().verifyToken(token, claim),
    runs: { getById: (id) => resolve().runs.getById(id) },
    feeds: {
      join: (run, sink, after) => resolve().feeds.join(run, sink, after),
    },
  };
}

function bind(pool: Pool): RunChannelDeps {
  const runs = new PgAssemblyRuns(pool);

  return {
    verifyToken: liveTokenVerifier(() => pool),
    runs,
    feeds: new RunFeedRegistry({
      runs,
      events: new PgAgentRunEvents(pool),
      taskEvents: new PgTaskEvents(pool),
      prStatus: fetchPrStatus,
      notifier: pgRunNotifier(),
    }),
  };
}
