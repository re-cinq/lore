/**
 * The request bodies of the event-DELIVERY HTTP surface.
 *
 * Here rather than beside the routes for the reason the queue's wire file gives:
 * the two ends of each call live in different packages, and a field declared
 * twice is a runtime 400 that both sides typecheck cleanly.
 *
 * `FailBody`, `DeadBody` and `PruneBody` are reused from the queue's wire — the
 * shapes are identical, and a second declaration would be the drift this file
 * exists to prevent.
 */

import { z } from "zod";

export const SubscribeBody = z.object({
  subscriber: z.string().min(1),
  subscriptions: z
    .array(
      z.object({
        eventName: z.string().min(1),
        // nonnegative, not positive: both adapters accept 0 (reap immediately),
        // so `positive` would 400 over HTTP a budget the store honours in-process.
        visibilityTimeoutSeconds: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
});

export const DeliveryClaimBody = z.object({
  subscriber: z.string().min(1),
  limit: z.number().int().positive(),
  excludeEventNames: z.array(z.string()).optional(),
});

export const OrphanBody = z.object({
  withinMinutes: z.number().int().positive(),
});

/** Same one field as {@link OrphanBody}, named apart because they are two calls:
 *  one reports the gap, the other closes it, and their windows differ. */
export const ReconcileBody = z.object({
  withinMinutes: z.number().int().positive(),
});

export type SubscribeBody = z.infer<typeof SubscribeBody>;
export type ReconcileBody = z.infer<typeof ReconcileBody>;
export type DeliveryClaimBody = z.infer<typeof DeliveryClaimBody>;
export type OrphanBody = z.infer<typeof OrphanBody>;
