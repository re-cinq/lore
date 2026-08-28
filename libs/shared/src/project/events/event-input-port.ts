/**
 * The shape of a thing that PRODUCES messages for the router, and the shape of
 * the place they end up.
 *
 * Before this, every producer invented its own answer to "the router is briefly
 * unreachable": the cluster-agent's watch had a retry ladder, `agent-reconcile`
 * had `.catch(() => {})`, `pr-ready-check` swallowed per run and marked the
 * delivery done anyway. An input declares WHAT it observed and nothing about how
 * hard to try — that belongs to the proxy it registers with.
 */

import type { EventInsert } from "../../events.js";

/**
 * One thing to deliver. Telemetry rides the same queue as events but lands
 * somewhere else: it is a verbatim NDJSON passthrough, not a bus event, and
 * putting per-tool-call volume through `pipeline.events` would abuse a dispatch
 * queue built for handler fan-out.
 */
export type ProxyMessage =
  { kind: "event"; event: EventInsert } | { kind: "telemetry"; body: string };

/**
 * Hand a message to the proxy. Resolves once it is QUEUED, not once it is
 * delivered — and blocks while the queue is full, which is the backpressure. An
 * input that does not await this is producing faster than the sink can drain and
 * has no way to find out.
 */
export type Emit = (message: ProxyMessage) => Promise<void>;

export interface EventInput {
  /** Stable identity, for the log line that names which input stalled. */
  readonly name: string;
  start(emit: Emit): Promise<void> | void;
  /** Idempotent: `stop` runs on shutdown and may run after a failed `start`. */
  stop(): Promise<void>;
}

/** Where a message of one kind actually goes. */
export interface Sink {
  deliver(message: ProxyMessage): Promise<void>;
}
