/** Bus end of proxy: Sink wrapping EventReporter (HTTP or local pool); converts event messages to inserts. */

import { enforceTrue } from "../../lib/enforce.js";
import type { EventReporter } from "./event-queue-port.js";
import type { ProxyMessage, Sink } from "./event-input-port.js";

export class EventSink implements Sink {
  constructor(private readonly reporter: EventReporter) {}

  // `async` so misrouted messages reject, not throw synchronously.
  async deliver(message: ProxyMessage): Promise<void> {
    enforceTrue(
      message.kind === "event",
      Error,
      `EventSink received a ${message.kind} message — the proxy routes by kind and should never send one here`,
    );

    await this.reporter.insert(message.event);
  }
}

/** Sink for unconfigured message kinds: refuses rather than silently dropping. */
export class UnconfiguredSink implements Sink {
  constructor(private readonly kind: string) {}

  deliver(): Promise<void> {
    return Promise.reject(
      new Error(`no ${this.kind} sink is configured for this process`),
    );
  }
}
