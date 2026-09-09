// Event reporting over HTTP: pool-less producers in unreachable locations; errors NOT swallowed.

import type { EventInsert } from "../../events.js";
import type { EventQueueRepository } from "./event-queue-port.js";
import { bearerJsonHeaders } from "../lib/http-auth.js";

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
    return bearerJsonHeaders(
      typeof this.token === "function" ? this.token() : this.token,
    );
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

  /** POST and parse; 204 is the ack/fail/dead answer, which has no body to .json() on. */
  protected async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.post(path, body);

    if (!res.ok) {
      throw new Error(`${path} failed: ${res.status}`);
    }

    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
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
