// HTTP delivery surface for pool-less subscribers; extends HttpEventReporter to avoid duplicating insert.

import { HttpEventReporter } from "./event-reporter-http.js";
import type {
  EventDeliveriesPort,
  EventDeliveryRow,
  EventSubscription,
  OrphanedEvents,
} from "./event-deliveries-port.js";
import type { FailBody, DeadBody } from "./event-queue-wire.js";
import type {
  DeliveryClaimBody,
  OrphanBody,
  ReconcileBody,
  SubscribeBody,
} from "./event-deliveries-wire.js";

export class HttpEventDeliveries
  extends HttpEventReporter
  implements EventDeliveriesPort
{
  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.post(path, body);

    if (!res.ok) {
      throw new Error(`${path} failed: ${res.status}`);
    }

    // 204 is the ack/fail/dead answer: no body to .json() on.
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void> {
    const body: SubscribeBody = { subscriber, subscriptions };

    await this.call("/api/subscriptions", body);
  }

  async claim(
    subscriber: string,
    limit: number,
    excludeEventNames: string[] = [],
  ): Promise<EventDeliveryRow[]> {
    const body: DeliveryClaimBody = { subscriber, limit, excludeEventNames };
    const { deliveries } = await this.call<{ deliveries: EventDeliveryRow[] }>(
      "/api/deliveries/claim",
      body,
    );

    return deliveries;
  }

  async markDone(id: string): Promise<void> {
    await this.call(`/api/deliveries/${encodeURIComponent(id)}/ack`);
  }

  async markFailed(
    id: string,
    error: string,
    backoffSeconds: number,
  ): Promise<void> {
    const body: FailBody = { error, backoffSeconds };

    await this.call(`/api/deliveries/${encodeURIComponent(id)}/fail`, body);
  }

  async markDead(id: string, error: string): Promise<void> {
    const body: DeadBody = { error };

    await this.call(`/api/deliveries/${encodeURIComponent(id)}/dead`, body);
  }

  async reapStuck(): Promise<number> {
    const { reaped } = await this.call<{ reaped: number }>(
      "/api/deliveries/reap",
    );

    return reaped;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    const { pruned } = await this.call<{ pruned: number }>(
      "/api/deliveries/prune",
      { olderThanDays },
    );

    return pruned;
  }

  async reconcileDeliveries(withinMinutes: number): Promise<number> {
    const body: ReconcileBody = { withinMinutes };
    const { reconciled } = await this.call<{ reconciled: number }>(
      "/api/deliveries/reconcile",
      body,
    );

    return reconciled;
  }

  async orphanedEvents(withinMinutes: number): Promise<OrphanedEvents[]> {
    const body: OrphanBody = { withinMinutes };
    const { orphaned } = await this.call<{ orphaned: OrphanedEvents[] }>(
      "/api/deliveries/orphaned",
      body,
    );

    return orphaned;
  }
}
