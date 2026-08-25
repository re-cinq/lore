/**
 * The six request bodies of the event-queue HTTP surface (ADR-044).
 *
 * They live here rather than beside the routes because the two ends of each
 * call are in different packages: `event-queue-http.ts` builds the body, and
 * `apps/event-router`'s routes parse it. Declared twice, a renamed field is a
 * runtime 400 that both sides typecheck cleanly — the drift no compiler catches.
 *
 * Not in `models/`: nothing here is a table row. `models/` binds columns to
 * fields; these bind a caller to a route.
 */

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
