// The production wiring of the live socket's run channel: the Postgres ports, the GitHub PR read, the process-wide notifier and the token verifier, all resolved from the pool the first time a channel opens, since the pool is created after the server is built.

import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRunReader,
  floorRunsFeed,
  runsOnFloor,
  runsReadingFloor,
  summariesOfBoth,
} from "../floor/floor-backed-runs.js";
import {
  FloorRunFeeds,
  type FloorRunFeedDeps,
} from "../floor/floor-run-feed.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { planSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import { PLANNING_DEFINITION } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { PgAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-pg.js";
import { PgTaskEvents } from "@re-cinq/lore-shared/project/task-events/task-events-pg.js";
import { fetchPrStatus } from "../../outbound/github-client.js";
import { pgPlanStore } from "../../outbound/plans/plan-store-pg.js";
import { liveTokenVerifier } from "./live-tokens.js";
import { RunFeedRegistry } from "./run-feed.js";
import { pgRunNotifier } from "./run-notify-hub.js";
import type { RunChannelDeps } from "./run-channel.js";
import type { RunsChannelDeps } from "./runs-channel.js";
import type { PlanRunChannelDeps } from "./plan-run-channel.js";
import { PlanRunWatch } from "./plan-run-watch.js";

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

/** The runs channel's dependencies: the same verifier as the run channel's, and the process's one feed on the floor where a floor is configured. */
export function runsChannelDepsFromPool(
  getPool: () => Pool | null,
): RunsChannelDeps {
  const resolve = boundOnce(getPool);

  return {
    verifyToken: (token, claim) => resolve().verifyToken(token, claim),
    feed: floorConfigured() ? floorRunsFeed() : null,
  };
}

/** The plan-run channel's dependencies: the run channel's own verifier, run reads and feeds (one registry per process), the plan store, both engines' runs read with no cost, and one watch on the floor's starts for every channel. */
export function planRunChannelDepsFromPool(
  getPool: () => Pool | null,
  run: RunChannelDeps,
): PlanRunChannelDeps {
  const pool = poolOrThrow(getPool);

  return {
    verifyToken: run.verifyToken,
    planExists: async (planId) =>
      (await pgPlanStore(pool).getMeta(planId)) !== null,
    planRuns: (planId) => planRunsOfBoth(pool(), planId),
    runs: run.runs,
    prStatus: (repo, prNumber) => fetchPrStatus(repo, prNumber),
    feeds: run.feeds,
    watch: floorConfigured()
      ? new PlanRunWatch({ feed: floorRunsFeed(), runs: run.runs })
      : null,
  };
}

/** A plan's planning runs from Postgres and the floor, read with no cost. */
function planRunsOfBoth(pool: Pool, planId: string) {
  return summariesOfBoth(
    new PgAssemblyRuns(pool),
    floorConfigured() ? floorRunReader() : null,
    { subjectKey: planSubject(planId), blueprintName: PLANNING_DEFINITION },
  );
}

function poolOrThrow(getPool: () => Pool | null): () => Pool {
  return () => {
    const pool = getPool();

    enforceTrue(pool !== null, Error, "database unavailable");

    return pool;
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
