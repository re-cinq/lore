/**
 * The bus end of the proxy: a `Sink` over whichever `EventReporter` this process
 * resolved (HTTP to the router, or the local pool in dev).
 *
 * It exists to keep the proxy generic. The proxy routes by message kind and
 * knows nothing about what a kind means; this is the one place that knows an
 * `event` message becomes an `insert`.
 */

import { enforceTrue } from "../../lib/enforce.js";
import type { EventReporter } from "./event-queue-port.js";
import type { ProxyMessage, Sink } from "./event-input-port.js";

export class EventSink implements Sink {
  constructor(private readonly reporter: EventReporter) {}

  // `async` so a misrouted message REJECTS rather than throwing synchronously:
  // a Sink's contract is a promise, and a caller that only catches rejections
  // would otherwise take the throw in its own frame.
  async deliver(message: ProxyMessage): Promise<void> {
    enforceTrue(
      message.kind === "event",
      Error,
      `EventSink received a ${message.kind} message — the proxy routes by kind and should never send one here`,
    );

    await this.reporter.insert(message.event);
  }
}

/**
 * The sink for a kind this process has not configured. It REFUSES rather than
 * dropping quietly, so the proxy's ladder logs the message by name — a
 * telemetry passthrough wired up on one end and not the other is otherwise
 * indistinguishable from no traffic.
 */
export class UnconfiguredSink implements Sink {
  constructor(private readonly kind: string) {}

  deliver(): Promise<void> {
    return Promise.reject(
      new Error(`no ${this.kind} sink is configured for this process`),
    );
  }
}
