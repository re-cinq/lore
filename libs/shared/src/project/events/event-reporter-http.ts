// Event reporting over HTTP: pool-less producers in unreachable locations; errors NOT swallowed.

import type { EventInsert } from "../../events.js";
import type { EventQueueRepository } from "./event-queue-port.js";

/** Timeout long enough for router load, short enough to release wedged producers. */
const TIMEOUT_MS = 15_000;

/** Producer half of EventQueueRepository over HTTP; HttpEventQueue extends for drainer. */
export class HttpEventReporter implements Pick<EventQueueRepository, "insert"> {
  /** Token may be function for rotating credentials (satellite cluster-agent, FR5). */
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string | (() => string | undefined),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    const token = typeof this.token === "function" ? this.token() : this.token;

    if (token) {
      h["authorization"] = `Bearer ${token}`;
    }

    return h;
  }

  /** POST to router with shared deadline. */
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
      // Status on error so caller can tell rotated token (401, re-register) from blip.
      throw Object.assign(new Error(`event insert failed: ${res.status}`), {
        status: res.status,
      });
    }
  }
}
