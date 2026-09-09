/** Request bodies of the event-delivery HTTP surface: single declaration shared across packages. */

import { z } from "zod";

export const SubscribeBody = z.object({
  subscriber: z.string().min(1),
  subscriptions: z
    .array(
      z.object({
        eventName: z.string().min(1),
        // nonnegative, not positive: both adapters accept 0 for immediate reap.
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

/** Same field as OrphanBody but separate calls with different windows. */
export const ReconcileBody = z.object({
  withinMinutes: z.number().int().positive(),
});

/** The dead-letter report's window — the third caller of this shape, kept separate for the same reason. */
export const DeadLetterBody = z.object({
  withinMinutes: z.number().int().positive(),
});

export type SubscribeBody = z.infer<typeof SubscribeBody>;
export type ReconcileBody = z.infer<typeof ReconcileBody>;
export type DeliveryClaimBody = z.infer<typeof DeliveryClaimBody>;
export type OrphanBody = z.infer<typeof OrphanBody>;
export type DeadLetterBody = z.infer<typeof DeadLetterBody>;

export const FailBody = z.object({
  error: z.string(),
  backoffSeconds: z.number().int().nonnegative(),
});

export const DeadBody = z.object({ error: z.string() });

export const PruneBody = z.object({
  olderThanDays: z.number().int().nonnegative(),
});

export type FailBody = z.infer<typeof FailBody>;
export type DeadBody = z.infer<typeof DeadBody>;
export type PruneBody = z.infer<typeof PruneBody>;
