// Which round a new round continues from.
//
// Planning history is a TREE, not a line: a round that went wrong can be dropped and
// the next one forked from an earlier round instead. That is only possible because
// each round saved its own transcript rather than overwriting the previous one, so
// round 2 is still there to continue after rounds 3 and 4 ran.

import type { FeatureIterationRow } from "./feature-types";

export interface RoundOption {
  iteration: number;
  label: string;
  /** The round this one forked from, when it was not simply the previous one. */
  parent: number | null;
}

/**
 * The rounds an author may continue from, newest first.
 *
 * Only rounds that produced a result: continuing from a failed round means
 * continuing from nothing, which would look like a rewind that silently did nothing.
 * An empty list means there is nothing to rewind to yet — the caller shows no picker
 * rather than an empty one.
 */
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

/**
 * How a round's lineage reads, or null when it simply followed the one before it.
 * Without this the history is a list pretending to be a tree — round 5 looks like a
 * refinement of round 4 when it actually descends from round 2.
 */
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
