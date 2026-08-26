// Reporting an event to the event-router over HTTP.
//
// `pipeline.events` has exactly one writer — the event-router — so every other
// producer reports through this instead of holding a pool. That is what lets a
// producer run somewhere the database does not reach: a cluster-agent in a
// satellite cluster, whose Kubernetes API is only visible from inside it.
//
// Deliberately NOT swallowed. An event that fails to land loses the work it was
// meant to start, and a caller that reports success anyway turns that into
// silence — which is how a resume behind a 202 went missing before. The caller
// decides what to do with the throw; this never decides for it.

import type { EventInsert } from "../../events.js";
import type { EventQueueRepository } from "./event-queue-port.js";

/** Long enough for a router under load, short enough that a wedged peer cannot
 *  hold the producer's loop open indefinitely. Matches the proxy client. */
const TIMEOUT_MS = 15_000;

/**
 * The producer half of {@link EventQueueRepository}, over HTTP.
 *
 * Only `insert` — the consume side belongs to whoever drains the queue, and a
 * producer that could claim its own events would be a different thing.
 * {@link HttpEventQueue} extends this for the drainer that needs both.
 */
export class HttpEventReporter implements Pick<EventQueueRepository, "insert"> {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };

    if (this.token) {
      h["authorization"] = `Bearer ${this.token}`;
    }

    return h;
  }

  /** One POST to the router, with the deadline every call shares. */
  protected post(path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async insert(input: EventInsert): Promise<void> {
    const res = await this.post("/api/events", input);

    if (!res.ok) {
      throw new Error(`event insert failed: ${res.status}`);
    }
  }
}
