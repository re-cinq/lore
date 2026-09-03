// Round continuation: planning history is a tree (rounds can fork from earlier rounds after failures); each round saves its own transcript.

import type { FeatureIterationRow } from "./feature-types";

export interface RoundOption {
  iteration: number;
  label: string;
  /** The round this one forked from, when it was not simply the previous one. */
  parent: number | null;
}

/** Rounds an author may rewind to, newest first; only rounds with results; empty list means no rewind yet. */
export function rewindOptions(
  iterations: FeatureIterationRow[],
): RoundOption[] {
  const ready = iterations.filter(
    (it) => it.status === "ready" && it.gap_result,
  );

  return ready
    .map((it, i) => ({
      iteration: it.iteration,
      label:
        i === ready.length - 1
          ? `Round ${it.iteration} (latest)`
          : `Round ${it.iteration}`,
      parent: it.parent_iteration ?? null,
    }))
    .reverse();
}

/** Lineage reading for a round, or null if it simply followed the previous one; distinguishes descents from earlier rounds. */
export function lineageLabel(option: RoundOption): string | null {
  return option.parent === null || option.parent === option.iteration - 1
    ? null
    : `forked from round ${option.parent}`;
}

/** Whether choosing this round means rewinding rather than continuing normally. */
export function isRewind(
  options: RoundOption[],
  chosen: number | undefined,
): boolean {
  return (
    chosen !== undefined &&
    options.length > 0 &&
    chosen !== options[0].iteration
  );
}
