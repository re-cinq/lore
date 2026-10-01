// The production wiring of the live socket's run channel: the Postgres ports, the GitHub PR read, the process-wide notifier and the token verifier, all resolved from the pool the first time a channel opens, since the pool is created after the server is built.

import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { runsOnFloor, runsReadingFloor } from "../floor/floor-backed-runs.js";
import {
  FloorRunFeeds,
  type FloorRunFeedDeps,
} from "../floor/floor-run-feed.js";
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
  const resolve = boundOnce(getPool);

  return {
    verifyToken: (token, claim) => resolve().verifyToken(token, claim),
    runs: { getById: (id) => resolve().runs.getById(id) },
    feeds: {
      join: (run, sink, after) => resolve().feeds.join(run, sink, after),
    },
  };
}

/** Binds to the pool on first use and keeps that binding: one feed registry and one verifier per process. */
function boundOnce(getPool: () => Pool | null): () => RunChannelDeps {
  let bound: RunChannelDeps | undefined;

  return () => {
    if (bound) {
      return bound;
    }
    const pool = getPool();

    enforceTrue(pool !== null, Error, "database unavailable");
    bound = bind(pool);

    return bound;
  };
}

function bind(pool: Pool): RunChannelDeps {
  const runs = runsReadingFloor(pool);
  const local = new RunFeedRegistry({
    runs,
    events: new PgAgentRunEvents(pool),
    taskEvents: new PgTaskEvents(pool),
    prStatus: fetchPrStatus,
    notifier: pgRunNotifier(),
  });

  return {
    verifyToken: liveTokenVerifier(() => pool),
    runs,
    feeds: feedsByEngine(local, floorFeeds(runs)),
  };
}

/** A run is followed where it runs: the floor's own journal for a floor run, Postgres for every other. */
export function feedsByEngine(
  local: RunChannelDeps["feeds"],
  floor: RunChannelDeps["feeds"],
): RunChannelDeps["feeds"] {
  return {
    join: (run, sink, after) =>
      (runsOnFloor(run) ? floor : local).join(run, sink, after),
  };
}

function floorFeeds(runs: FloorRunFeedDeps["runs"]): RunChannelDeps["feeds"] {
  return new FloorRunFeeds({
    watch: (runId, options) => floorClient().runs.watch(runId, options),
    runs,
  });
}
