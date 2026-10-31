import { loopPaused } from "./loop-pause.js";
import { parsedSettings } from "./raw-settings.js";

/** The per-repo `implementation_loop.enabled` opt-in (FR7); a plain setting, since the loop never merges and needs no two-key CODEOWNERS ceremony. */
export function implementationLoopSwitchedOn(rawSettings: unknown): boolean {
  const block = (
    parsedSettings(rawSettings) as {
      implementation_loop?: { enabled?: unknown };
    } | null
  )?.implementation_loop;

  return block?.enabled === true;
}

/** Whether the implementation loop may start work: switched on and not paused. */
export function implementationLoopEnabled(rawSettings: unknown): boolean {
  return (
    implementationLoopSwitchedOn(rawSettings) &&
    !loopPaused("implementation", rawSettings)
  );
}
