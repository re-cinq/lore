// HTTP delivery surface for pool-less subscribers; extends HttpEventReporter to avoid duplicating insert.

import { HttpEventReporter } from "./event-reporter-http.js";
import type {
  EventDeliveriesPort,
  EventDeliveryRow,
  EventSubscription,
  OrphanedEvents,
  DeadLetteredDeliveries,
} from "./event-deliveries-port.js";
import type { FailBody, DeadBody } from "./event-deliveries-wire.js";
import type {
  DeadLetterBody,
  DeliveryClaimBody,
  OrphanBody,
  ReconcileBody,
  SubscribeBody,
} from "./event-deliveries-wire.js";

export class HttpEventDeliveries
  extends HttpEventReporter
  implements EventDeliveriesPort
{
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

  async deadLettered(withinMinutes: number): Promise<DeadLetteredDeliveries[]> {
    const body: DeadLetterBody = { withinMinutes };
    const { dead } = await this.call<{ dead: DeadLetteredDeliveries[] }>(
      "/api/deliveries/dead-lettered",
      body,
    );

    return dead;
  }
}
