// A loop held without touching its switch: a pause in `settings.loop_pauses.<key>` stops the loop starting runs until it is resumed or its `until` passes. Model credit running out pauses with no end; a pause with an end resumes by itself.
import { z } from "zod";
import type { LoopKey } from "./loop-kinds.js";
import { parsedSettings } from "./raw-settings.js";

export const LoopPauseSchema = z.object({
  reason: z.string(),
  run_id: z.string().nullable(),
  at: z.string(),
  until: z.string().nullable(),
});

export type LoopPause = z.infer<typeof LoopPauseSchema>;

const PausesSchema = z.object({
  loop_pauses: z.record(z.string(), z.unknown()),
});

export function loopPause(
  key: LoopKey,
  rawSettings: unknown,
): LoopPause | null {
  const settings = PausesSchema.safeParse(parsedSettings(rawSettings));
  const pause = LoopPauseSchema.safeParse(settings.data?.loop_pauses[key]);

  return pause.success ? pause.data : null;
}

export function pauseActive(pause: LoopPause | null, now: Date): boolean {
  return (
    pause !== null && (pause.until === null || new Date(pause.until) > now)
  );
}

export function loopPaused(key: LoopKey, rawSettings: unknown): boolean {
  return pauseActive(loopPause(key, rawSettings), new Date());
}
