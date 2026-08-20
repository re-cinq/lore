// How a classified node failure reads to the person who has to act on it, and
// whether the walk should bother retrying it (#1455).
//
// Both questions have exactly one answer, in one place, because both are asked
// from two sides of the fence: the pure transition replay decides the retry, the
// Floor composes the line's terminal reason, and a version of either that drifted
// would put a different story in the run row than in the task the author reads.

import {
  failureHint,
  isFailureCategory,
  isPermanentFailure,
} from "@re-cinq/lore-shared/error-classify.js";

/** A failed visit, as both the replay and the Floor hold one. */
export interface NodeFailure {
  nodeId: string;
  failureClass?: string | null;
  failureDetail?: string | null;
}

/**
 * The line's terminal reason for a failed node: what died, what it said, and what
 * to do about it.
 *
 * This replaces the routing statement that used to reach authors — "edge
 * analyze->analyze exceeded iteration_max 1" is true of the WALK and silent about
 * the CAUSE. An unclassified failure degrades to the old wording rather than
 * inventing one.
 */
export function nodeFailureReason(failure: NodeFailure): string {
  const named = `node "${failure.nodeId}" failed`;

  if (!failure.failureDetail) {
    return named;
  }
  const hint = hintFor(failure.failureClass);

  return `${named}: ${failure.failureDetail}${hint ? ` — ${hint}` : ""}`;
}

/**
 * True when running the node again cannot possibly help: the balance, the
 * credential, or the permission has to change first. The walk spends no
 * `iteration_max` budget on these — the retry buys a second identical failure,
 * several minutes later, and a less honest report than the first one.
 */
export function isPermanentNodeFailure(failure: NodeFailure): boolean {
  const category = failure.failureClass;

  if (!category || !isFailureCategory(category)) {
    return false;
  }

  return isPermanentFailure(category);
}

/** The remediation line for a class, or "" for an absent or unrecognised one. */
function hintFor(category: string | null | undefined): string {
  if (!category || !isFailureCategory(category)) {
    return "";
  }

  return failureHint(category);
}
