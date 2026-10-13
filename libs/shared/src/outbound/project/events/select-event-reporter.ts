// Every producer reports straight to its own pool: GitHub's webhooks land on lore-api, which writes `pipeline.events` itself (ADR-044 amendment).

import { EventProxy } from "./event-proxy.js";
import { EventSink, UnconfiguredSink } from "./event-sink.js";
import type { EventReporter } from "./event-reporter-port.js";
import {
  DEFAULT_QUEUE_CAPACITY,
  DEFAULT_REPORT_RETRY,
} from "./event-tuning.js";

export interface LocalProxyDeps {
  /** Pool-backed reporter; a THUNK because eager resolution forced lore-api to demand a database even in tests with their own injected one. */
  local: () => EventReporter;
  capacity?: number;
  retry?: { attempts: number; delayMs: number };
}

/** The {@link EventProxy} of a process that holds a pool: it reports straight to `pipeline.events`; call once at a composition root and memoize. A failed Postgres insert is not a wire blip, so the default retry is short. */
export function localEventProxy(deps: LocalProxyDeps): EventProxy {
  return new EventProxy({
    sinks: {
      event: new EventSink(deps.local()),
      telemetry: new UnconfiguredSink("telemetry"),
    },
    capacity: deps.capacity ?? DEFAULT_QUEUE_CAPACITY,
    retry: deps.retry ?? DEFAULT_REPORT_RETRY,
  });
}
