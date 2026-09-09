// How a classified node failure reads to the person acting on it, and whether the walk should retry it (#1455) — one answer in one place, since the transition replay and the Floor's terminal-reason composer must never drift apart.

import {
  failureHint,
  isFailureCategory,
  isPermanentFailure,
} from "@re-cinq/lore-shared/error-classify.js";

// A failed visit, as both the replay and the Floor hold one.
export interface NodeFailure {
  nodeId: string;
  failureClass?: string | null;
  failureDetail?: string | null;
}

// The line's terminal reason for a failed node (what died, what it said, what to do): replaces "edge analyze->analyze exceeded iteration_max 1", true of the WALK but silent about the CAUSE; an unclassified failure degrades to the old wording.
export function nodeFailureReason(failure: NodeFailure): string {
  const named = `node "${failure.nodeId}" failed`;

  if (!failure.failureDetail) {
    return named;
  }
  const hint = hintFor(failure.failureClass);

  return `${named}: ${failure.failureDetail}${hint ? ` — ${hint}` : ""}`;
}

// True when a retry cannot possibly help (balance/credential/permission must change first) — the walk spends no iteration_max budget on these.
export function isPermanentNodeFailure(failure: NodeFailure): boolean {
  const category = failure.failureClass;

  if (!category || !isFailureCategory(category)) {
    return false;
  }

  return isPermanentFailure(category);
}

// The remediation line for a class, or "" for an absent or unrecognised one.
function hintFor(category: string | null | undefined): string {
  if (!category || !isFailureCategory(category)) {
    return "";
  }

  return failureHint(category);
}
