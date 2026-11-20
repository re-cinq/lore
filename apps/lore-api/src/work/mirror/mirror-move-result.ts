import { z } from "zod";

/** What moving a mirror's stored knowledge did, step by step. */
export const MirrorMoveResultSchema = z.object({
  mirror: z.string(),
  dry_run: z.boolean(),
  tables: z.array(
    z.object({
      table: z.string(),
      moved: z.number(),
      kept_conflict: z.number(),
    }),
  ),
  cancelled_runs: z.array(z.string()),
  mirror_variable: z
    .object({ set: z.boolean(), reason: z.string().optional() })
    .optional(),
  mirror_row_deleted: z.boolean(),
});

export type MirrorMoveResult = z.infer<typeof MirrorMoveResultSchema>;
