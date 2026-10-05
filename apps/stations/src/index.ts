// The stations process: opens the pool, loads shared approval config, serves, emits the cron ticks every scheduled sweep hangs off, and drains the bus for the events and nodes whose station runs here.

import {
  onTerminationSignals,
  runEntrypoint,
} from "@re-cinq/lore-shared/lib/process-entry.js";
import { getPool, initPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { startServer } from "./transport/server.js";
import { startStationDrain } from "./events/loop-boot.js";
import {
  deliveries,
  eventProxy,
  eventReporter,
  pipeline,
  usage,
} from "./outbound/queues.js";
import { CRON_EMITTERS } from "@re-cinq/lore-shared/scheduler/cron-emitters.js";
import {
  createCronScheduler,
  registerCronEmitters,
} from "@re-cinq/lore-shared/scheduler/cron-scheduler.js";
import { DEFAULT_DRAIN_TIMEOUT_MS } from "@re-cinq/lore-shared/project/events/event-tuning.js";
import { startDeliveryReaper } from "@re-cinq/lore-shared/housekeeping/delivery-reaper.js";
import { requiredPort } from "@re-cinq/lore-shared/lib/required-env.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { startCodeReviewStations } from "./code-review/index.js";
import { startPlanningStations } from "./planning/index.js";
import { startMergeStations } from "./merge/index.js";
import { startDigestStations } from "./digest/index.js";
import { startOnboardStations } from "./onboard/index.js";
import { startSpecUpkeepStations } from "./spec-upkeep/index.js";
import { startImplementationLoopStations } from "./implementation-loop/index.js";

const PORT = requiredPort(process.env, "PORT");

// How long shutdown waits for the event queue to drain — long enough for a backlog, short enough not to hold a rollout past its grace period.
async function main(): Promise<void> {
  initPool();
  // Service-run stations may call a model (the retrospective's Haiku curation); wiring the UsagePort here makes those land in pipeline.llm_calls like the Floor's own calls.
  Llm.configure({ usage: usage() });

  // Before the server: a published node with nobody claiming it sits open until reaped, and merge_step has no pod fallback.
  const drain = await startStationDrain(drainDeps());

  // Started before the server: the queue only drains while its loop runs, so an earlier emit would sit in memory until shutdown noticed it.
  await eventProxy().start();
  void startCronTicks();
  // The bus's crash recovery for every subscriber: this service is the one that keeps it now (specs/external-floor FR16).
  startDeliveryReaper(() => deliveries().reapStuck());

  const stopServer = await startServer(PORT);
  const floorStations = startFloorStations();

  const shutdown = shutdownHandler(drain, async () => {
    await Promise.all(floorStations.map((station) => station.stop()));
    await stopServer();
  });

  onTerminationSignals(shutdown);
}

/** The `cron.<name>.tick` events every scheduled sweep and line start hangs off. This service is their one emitter (specs/external-floor FR16); it runs a single replica, and the scheduler reads each job's last run from `pipeline.job_runs`, so an emitter still running elsewhere during a rollout takes turns with it. */
function startCronTicks(): Promise<void> {
  const scheduler = createCronScheduler(pipeline().jobRuns);

  registerCronEmitters(scheduler, CRON_EMITTERS, (event) =>
    eventReporter().insert(event),
  );

  return scheduler.start();
}

/** The floor's stations claim from the floor's queue, not the bus: without a floor there is nothing for them to ask. */
function startFloorStations() {
  return floorConfigured()
    ? [
        ...startCodeReviewStations(),
        ...startPlanningStations(),
        ...startMergeStations(),
        ...startDigestStations(),
        ...startOnboardStations(),
        ...startSpecUpkeepStations(),
        ...startImplementationLoopStations(),
      ]
    : [];
}

/** Each call goes through `deliveries()` rather than capturing it — the singleton is lazy because it needs an initialised pool, which `main` has only just arranged. */
function drainDeps(): Parameters<typeof startStationDrain>[0] {
  return {
    subscribe: (subscriber, subs) => deliveries().subscribe(subscriber, subs),
    reconcileDeliveries: (withinMinutes) =>
      deliveries().reconcileDeliveries(withinMinutes),
    claim: (subscriber, limit, exclude) =>
      deliveries().claim(subscriber, limit, exclude),
    markDone: (id) => deliveries().markDone(id),
    markFailed: (id, error, backoff) =>
      deliveries().markFailed(id, error, backoff),
    markDead: (id, error) => deliveries().markDead(id, error),
  };
}

/** Shutdown in the order the failure modes demand: stop claiming, stop serving, then drain the in-memory queue BEFORE the pool closes — a dropped resume leaves its parked node waiting for the reaper. */
function shutdownHandler(
  drain: NodeJS.Timeout,
  stopServer: () => Promise<void>,
): (signal: string) => Promise<void> {
  return async (signal: string) => {
    console.log(`[stations] ${signal} — shutting down`);
    clearInterval(drain);
    await stopServer();

    const undrained = await eventProxy().stop(DEFAULT_DRAIN_TIMEOUT_MS);

    if (undrained > 0) {
      console.error(
        `[stations] exiting with ${undrained} undelivered event(s) — the reconcile pass is what re-emits them`,
      );
    }
    await getPool().end();
    process.exit(0);
  };
}

runEntrypoint("stations", main);
