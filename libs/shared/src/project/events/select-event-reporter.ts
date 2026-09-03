// Where a producer reports its events: HTTP to the event-router (ADR-044) when reachable, else the local pool — logged once so a lost EVENT_ROUTER_URL in a cluster isn't a silent degradation.

import { internalToken } from "../../http/internal-token.js";
import { HttpEventReporter } from "./event-reporter-http.js";
import { HttpEventQueue } from "./event-queue-http.js";
import { HttpEventDeliveries } from "./event-deliveries-http.js";
import { EventProxy } from "./event-proxy.js";
import { EventSink, UnconfiguredSink } from "./event-sink.js";
import type { Sink } from "./event-input-port.js";
import type { EventDeliveriesPort } from "./event-deliveries-port.js";
import type {
  EventQueueRepository,
  EventReporter,
} from "./event-queue-port.js";

export interface SelectReporterDeps {
  /** Pool-backed reporter to fall back to; a THUNK because eager resolution forced lore-api to demand a database even in tests with their own injected one. */
  local: () => EventReporter;
  /** Bearer to present when not the bus-wide token; a THUNK because a rotating per-agent credential captured as a value 401s every report after rotation (lost run 595d2b0b's terminal event). */
  token?: string | (() => string | undefined);
  /** Injected so the HTTP branch is reachable from a test without a network. */
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/** Resolve the reporter for this process; call once at a composition root and memoize — the log line is meant to appear once per boot. */
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

  return new HttpEventReporter(
    url,
    deps.token ?? internalToken(env),
    deps.fetchImpl ?? fetch,
  );
}

/** Room for a router blip at the observed peak rate, not a durability budget — the queue is in memory and dies with the process. */
const DEFAULT_CAPACITY = 256;
const DEFAULT_RETRY = { attempts: 5, delayMs: 500 };

export interface SelectProxyDeps extends SelectReporterDeps {
  capacity?: number;
  retry?: { attempts: number; delayMs: number };
  /** Rotate the credential when a sink refuses it — a satellite's single-flight re-registration; a static-token process leaves this unset. */
  onUnauthorized?: () => Promise<unknown>;
  /** Only a process that forwards agent telemetry configures this. */
  telemetry?: Sink;
}

/** Resolve the {@link EventProxy} (queued emit + synchronous insert) this process reports through; always a proxy so a caller holds one type — local mode retries once since a failed Postgres insert is not a wire blip. Call once at a composition root and memoize. */
export function selectEventProxy(deps: SelectProxyDeps): EventProxy {
  const env = deps.env ?? process.env;
  const routed = Boolean(env.EVENT_ROUTER_URL);
  const reporter = selectEventReporter(deps);

  return new EventProxy({
    sinks: {
      event: new EventSink(reporter),
      telemetry: deps.telemetry ?? new UnconfiguredSink("telemetry"),
    },
    capacity: deps.capacity ?? DEFAULT_CAPACITY,
    retry: deps.retry ?? (routed ? DEFAULT_RETRY : { attempts: 1, delayMs: 0 }),
    onUnauthorized: deps.onUnauthorized,
  });
}

export interface SelectQueueDeps {
  /** The pool-backed queue to fall back to — normally `pipeline().eventQueue`. */
  local: () => EventQueueRepository;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/** Resolve the whole queue for a DRAINER, same way as {@link selectEventReporter} — separate because a producer gets `insert` only, and just the draining process asks for this. */
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

/** Resolve the DELIVERY side for a subscriber, same three ways as above — separate because consuming a subscriber's own copies is a different privilege from draining the shared queue. */
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
