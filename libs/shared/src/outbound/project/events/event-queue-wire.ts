/** The six request bodies of the event-queue HTTP surface (ADR-044); declared twice (builder + router) since the two ends live in different packages. Not in `models/` — nothing here is a table row. */

import { z } from "zod";

export const ClaimBody = z.object({
  limit: z.number().int().positive(),
  excludeEventNames: z.array(z.string()).optional(),
});

export const FailBody = z.object({
  error: z.string(),
  backoffSeconds: z.number().int().nonnegative(),
});

export const DeadBody = z.object({ error: z.string() });

export const ReapBody = z.object({
  timeoutSeconds: z.number().int().nonnegative(),
});

export const PruneBody = z.object({
  olderThanDays: z.number().int().nonnegative(),
});

export type ClaimBody = z.infer<typeof ClaimBody>;
export type FailBody = z.infer<typeof FailBody>;
export type DeadBody = z.infer<typeof DeadBody>;
export type ReapBody = z.infer<typeof ReapBody>;
export type PruneBody = z.infer<typeof PruneBody>;
