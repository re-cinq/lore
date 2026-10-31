import { z } from "zod";
import { LOOP_KEYS } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { LoopPauseSchema } from "@re-cinq/lore-shared/loops/loop-pause.js";
import { OkTrue } from "../../http/ok-schema.js";

export const LoopKeySchema = z.enum(LOOP_KEYS);

export const RepoLoopSchema = z.object({
  key: LoopKeySchema,
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** The loop's pause while it holds, or null. */
  paused: LoopPauseSchema.nullable(),
});

export const RepoLoopsSchema = z.object({
  loops: z.array(RepoLoopSchema),
});

export const LoopSwitchBodySchema = z.object({
  enabled: z.boolean(),
});

export const LoopSwitchResultSchema = z.object({
  ok: OkTrue,
  key: LoopKeySchema,
  enabled: z.boolean(),
});

export type RepoLoop = z.infer<typeof RepoLoopSchema>;

export const LoopResumeResultSchema = z.object({
  ok: OkTrue,
  key: LoopKeySchema,
  /** The run whose credit-starved station was started again, or null. */
  rerun_run_id: z.string().nullable(),
});
