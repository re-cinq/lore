import { z } from "zod";
import { LOOP_KEYS } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { OkTrue } from "../../http/ok-schema.js";

export const LoopKeySchema = z.enum(LOOP_KEYS);

export const RepoLoopSchema = z.object({
  key: LoopKeySchema,
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** The auto-merge loop's one setting: hours a pull request must have been open before the loop merges it. Absent on every other loop. */
  min_age_hours: z.number().int().min(0).optional(),
});

export const RepoLoopsSchema = z.object({
  loops: z.array(RepoLoopSchema),
});

export const LoopSwitchBodySchema = z.object({
  enabled: z.boolean(),
  /** Only the auto-merge loop reads it. */
  min_age_hours: z.number().int().min(0).optional(),
});

export const LoopSwitchResultSchema = z.object({
  ok: OkTrue,
  key: LoopKeySchema,
  enabled: z.boolean(),
});

export type RepoLoop = z.infer<typeof RepoLoopSchema>;
