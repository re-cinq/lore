// Where a producer reports its events.
//
// The same three-way shape `agentDefs` uses (`PgAgentDefs` / `AgentDefsHttp` /
// `AgentDefsYaml`, selected on the environment in `project-factory`): the
// event-router owns `pipeline.events` (ADR-044), so a producer that can see the
// router reports over HTTP, and one that cannot falls back to the pool it
// already holds.
//
// The fallback is for LOCAL DEVELOPMENT, where `npm start` brings up a Floor and
// a Postgres but no router. It is NOT a silent degradation in a cluster: a
// deployment that means to route and has lost `EVENT_ROUTER_URL` would write
// directly and look healthy, so the choice is logged once at construction.

import { internalToken } from "../../http/internal-token.js";
import { HttpEventReporter } from "./event-reporter-http.js";
import { HttpEventQueue } from "./event-queue-http.js";
import { HttpEventDeliveries } from "./event-deliveries-http.js";
import type { EventDeliveriesPort } from "./event-deliveries-port.js";
import type {
  EventQueueRepository,
  EventReporter,
} from "./event-queue-port.js";

export interface SelectReporterDeps {
  /**
   * The pool-backed reporter to fall back to — normally `pipeline().eventQueue`.
   *
   * A THUNK, not a value: resolving it usually means resolving a pool, and a
   * process that reports to the router has no reason to hold one. Passing the
   * value eagerly is what made lore-api demand a database in tests that had
   * deliberately injected their own.
   */
  local: () => EventReporter;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/**
 * Resolve the reporter for this process. Call once, at a composition root, and
 * memoize there — the log line is meant to appear once per boot, not per event.
 */
export function selectEventReporter(deps: SelectReporterDeps): EventReporter {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const url = env.EVENT_ROUTER_URL;

  if (!url) {
    log(
      "[events] EVENT_ROUTER_URL unset — reporting directly to pipeline.events (local mode)",
    );

    return deps.local();
  }
  log(`[events] reporting to the event-router at ${url}`);

  return new HttpEventReporter(url, internalToken(env));
}

export interface SelectQueueDeps {
  /** The pool-backed queue to fall back to — normally `pipeline().eventQueue`. */
  local: () => EventQueueRepository;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/**
 * Resolve the whole queue for a DRAINER, the same way {@link selectEventReporter}
 * resolves the producer half.
 *
 * Separate from the reporter because the privileges differ: a producer gets
 * `insert` and nothing else, and only the process that drains asks for this.
 */
export function selectEventQueue(deps: SelectQueueDeps): EventQueueRepository {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const url = env.EVENT_ROUTER_URL;

  if (!url) {
    log(
      "[events] EVENT_ROUTER_URL unset — draining pipeline.events directly (local mode)",
    );

    return deps.local();
  }
  log(`[events] draining through the event-router at ${url}`);

  return new HttpEventQueue(url, internalToken(env));
}

export interface SelectDeliveriesDeps {
  /** The pool-backed deliveries to fall back to. */
  local: () => EventDeliveriesPort;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/**
 * Resolve the DELIVERY side for a subscriber, the same three ways as above.
 *
 * Separate from the queue for the same reason the queue is separate from the
 * reporter: a subscriber consumes its own copies of events, which is a different
 * privilege from draining the shared queue, and only a process that subscribes
 * asks for this.
 */
export function selectEventDeliveries(
  deps: SelectDeliveriesDeps,
): EventDeliveriesPort {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const url = env.EVENT_ROUTER_URL;

  if (!url) {
    log(
      "[events] EVENT_ROUTER_URL unset — consuming deliveries directly (local mode)",
    );

    return deps.local();
  }
  log(`[events] consuming deliveries through the event-router at ${url}`);

  return new HttpEventDeliveries(url, internalToken(env));
}
