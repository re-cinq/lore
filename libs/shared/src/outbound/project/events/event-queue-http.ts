// HTTP event queue for pool-less drainers; extends HttpEventReporter to avoid duplicating insert.

import { HttpEventReporter } from "./event-reporter-http.js";
import type { EventQueueRepository, EventRow } from "./event-queue-port.js";
import type {
  ClaimBody,
  DeadBody,
  FailBody,
  PruneBody,
  ReapBody,
} from "./event-queue-wire.js";

export class HttpEventQueue
  extends HttpEventReporter
  implements EventQueueRepository
{
  async claimBatch(
    limit: number,
    excludeEventNames: string[] = [],
  ): Promise<EventRow[]> {
    const body: ClaimBody = { limit, excludeEventNames };
    const { events } = await this.call<{ events: EventRow[] }>(
      "/api/events/claim",
      body,
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
    const body: FailBody = { error, backoffSeconds };

    await this.call(`/api/events/${encodeURIComponent(id)}/fail`, body);
  }

  async markDead(id: string, error: string): Promise<void> {
    const body: DeadBody = { error };

    await this.call(`/api/events/${encodeURIComponent(id)}/dead`, body);
  }

  async reapStuck(timeoutSeconds: number): Promise<number> {
    const body: ReapBody = { timeoutSeconds };
    const { reaped } = await this.call<{ reaped: number }>(
      "/api/events/reap",
      body,
    );

    return reaped;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    const body: PruneBody = { olderThanDays };
    const { pruned } = await this.call<{ pruned: number }>(
      "/api/events/prune",
      body,
    );

    return pruned;
  }
}
