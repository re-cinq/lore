import { loopPaused } from "./loop-pause.js";
import { parsedSettings } from "./raw-settings.js";

/** The per-repo `auto_review` opt-in, the code-review loop's switch, read off the repository's settings however they were stored; off by omission. */
export function autoReviewSwitchedOn(rawSettings: unknown): boolean {
  return (
    (parsedSettings(rawSettings) as { auto_review?: boolean } | null)
      ?.auto_review === true
  );
}

/** Whether the code-review loop may start work: switched on and not paused. */
export function autoReviewEnabled(rawSettings: unknown): boolean {
  return (
    autoReviewSwitchedOn(rawSettings) && !loopPaused("review", rawSettings)
  );
}
