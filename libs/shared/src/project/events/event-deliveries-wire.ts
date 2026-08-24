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
        visibilityTimeoutSeconds: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

export const DeliveryClaimBody = z.object({
  subscriber: z.string().min(1),
  limit: z.number().int().positive(),
});

export const OrphanBody = z.object({
  withinMinutes: z.number().int().positive(),
});

export type SubscribeBody = z.infer<typeof SubscribeBody>;
export type DeliveryClaimBody = z.infer<typeof DeliveryClaimBody>;
export type OrphanBody = z.infer<typeof OrphanBody>;
