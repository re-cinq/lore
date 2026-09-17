// Where a producer reports its events: HTTP to the event-router (ADR-044) when reachable, else the local pool — logged once so a lost EVENT_ROUTER_URL in a cluster isn't a silent degradation.

import { internalToken } from "../../../lib/internal-token.js";
import { HttpEventReporter } from "./event-reporter-http.js";
import { HttpEventDeliveries } from "./event-deliveries-http.js";
import { EventProxy } from "./event-proxy.js";
import { EventSink, UnconfiguredSink } from "./event-sink.js";
import type { Sink } from "./event-input-port.js";
import type { EventDeliveriesPort } from "./event-deliveries-port.js";
import type { EventReporter } from "./event-reporter-port.js";
import {
  DEFAULT_QUEUE_CAPACITY,
  DEFAULT_REPORT_RETRY,
} from "./event-tuning.js";

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

export interface SelectProxyDeps extends SelectReporterDeps {
  capacity?: number;
  retry?: { attempts: number; delayMs: number };
  /** Rotate the credential when a sink refuses it — a satellite's single-flight re-registration; a static-token process leaves this unset. */
  onUnauthorized?: () => Promise<unknown>;
  /** Only a process that forwards agent telemetry configures this. */
  telemetry?: Sink;
}

/** The {@link EventProxy} this process reports through — always a proxy so callers hold one type; call once at a composition root and memoize. Local mode retries once, since a failed Postgres insert is not a wire blip. */
export function selectEventProxy(deps: SelectProxyDeps): EventProxy {
  const reporter = selectEventReporter(deps);

  return new EventProxy({
    sinks: {
      event: new EventSink(reporter),
      telemetry: deps.telemetry ?? new UnconfiguredSink("telemetry"),
    },
    capacity: deps.capacity ?? DEFAULT_QUEUE_CAPACITY,
    retry: deps.retry ?? DEFAULT_REPORT_RETRY,
    onUnauthorized: deps.onUnauthorized,
  });
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
