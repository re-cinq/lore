// The whole event queue over HTTP — what a drainer that holds no pool uses.
//
// Extends the reporter rather than restating `insert`: a drainer is a producer
// too (a handler that emits a follow-up event), and two implementations of one
// call is how they come to disagree about the retry ladder.
//
// The atomicity of `claimBatch` is unchanged and lives server-side, inside one
// `FOR UPDATE SKIP LOCKED` statement — this only carries the request, so two
// drainers still receive disjoint batches.

import { HttpEventReporter } from "./event-reporter-http.js";
import type { EventQueueRepository, EventRow } from "./event-queue-port.js";

export class HttpEventQueue
  extends HttpEventReporter
  implements EventQueueRepository
{
  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.post(path, body);

    if (!res.ok) {
      throw new Error(`${path} failed: ${res.status}`);
    }

    // 204 is the ack/fail/dead answer: nothing to read, and calling .json() on
    // an empty body would throw where the call actually succeeded.
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async claimBatch(
    limit: number,
    excludeEventNames: string[] = [],
  ): Promise<EventRow[]> {
    const { events } = await this.call<{ events: EventRow[] }>(
      "/api/events/claim",
      { limit, excludeEventNames },
    );

    return events;
  }

  async markDone(id: string): Promise<void> {
    await this.call(`/api/events/${encodeURIComponent(id)}/ack`);
  }

  async markFailed(
    id: string,
    error: string,
    backoffSeconds: number,
  ): Promise<void> {
    await this.call(`/api/events/${encodeURIComponent(id)}/fail`, {
      error,
      backoffSeconds,
    });
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.call(`/api/events/${encodeURIComponent(id)}/dead`, { error });
  }

  async reapStuck(timeoutSeconds: number): Promise<number> {
    const { reaped } = await this.call<{ reaped: number }>("/api/events/reap", {
      timeoutSeconds,
    });

    return reaped;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    const { pruned } = await this.call<{ pruned: number }>(
      "/api/events/prune",
      { olderThanDays },
    );

    return pruned;
  }
}
