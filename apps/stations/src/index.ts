// The stations process: opens the pool, loads shared approval config, serves — schedules nothing itself (the Floor owns WHEN) but drains the bus for nodes whose station runs here.

import {
  onTerminationSignals,
  runEntrypoint,
} from "@re-cinq/lore-shared/lib/process-entry.js";
import { loadApprovalConfig } from "@re-cinq/lore-shared";
import { getPool, initPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { startServer } from "./transport/server.js";
import { startStationDrain } from "./events/loop-boot.js";
import { deliveries, eventProxy, usage } from "./outbound/queues.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

// How long shutdown waits for the event queue to drain — long enough for a backlog, short enough not to hold a rollout past its grace period.
const EVENT_DRAIN_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  initPool();
  // Module state read by approval-check; the Floor loads the same config for its worker's gate.
  await loadApprovalConfig(getPool());
  // Service-run stations may call a model (comment-triage's Haiku); wiring the UsagePort here makes those land in pipeline.llm_calls like the Floor's own calls.
  Llm.configure({ usage: usage() });

  // Before the server: a published node with nobody claiming it sits open until reaped, and merge_step has no pod fallback.
  const drain = await startStationDrain(drainDeps());

  // Started before the server: the queue only drains while its loop runs, so an earlier emit would sit in memory until shutdown noticed it.
  await eventProxy().start();

  const stopServer = await startServer(PORT);

  const shutdown = shutdownHandler(drain, stopServer);

  onTerminationSignals(shutdown);
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

    const undrained = await eventProxy().stop(EVENT_DRAIN_TIMEOUT_MS);

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
