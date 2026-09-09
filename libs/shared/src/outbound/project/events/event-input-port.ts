/** Producer and consumer shapes for the router: inputs declare what, proxy handles retry. */

import type { EventInsert } from "../../events.js";

/** Event or telemetry to deliver; telemetry is NDJSON passthrough, not a bus event. */
export type ProxyMessage =
  { kind: "event"; event: EventInsert } | { kind: "telemetry"; body: string };

/** Hand a message to proxy: resolved when queued, blocks while queue full (backpressure). */
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
