// Whether a backlog tick continues the branch a previous attempt left behind, or
// starts the ticket over (specs/implementation-loop FR11).
//
// A run that dies leaves its commits on the ticket's branch. Nothing read them: a
// fresh run has no station_runs rows, so the replay launches the entry node and the
// work is done again. Continuing is the default now — but only for a branch nobody
// has ruled on.
//
// Pure, because every input is a fact somebody else already read (does the branch
// exist, what does the issue carry, did the last run settle) and the decision is
// the part worth testing on its own.

import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared";
import { CLEAN_OUTCOMES } from "./loop-run-closed.js";

export interface BranchResumeInput {
  /** `undefined` when the port could not answer — unknown, never "no". */
  branchExists: boolean | undefined;
  issueLabels: readonly string[];
  openPr: { number: number; url: string } | null;
  /** Terminal outcome of the newest prior run on this branch; null when unknown. */
  priorRunOutcome: string | null;
}

export type BranchResume =
  { resume: false } | { resume: true; lineArgs: Record<string, unknown> };

const FRESH: BranchResume = { resume: false };

export function decideBranchResume(input: BranchResumeInput): BranchResume {
  // Deleting the branch IS the restart protocol — the repo owner's only lever, and
  // the reason nothing here needs a force flag or a comment to explain itself.
  if (input.branchExists !== true) {
    return FRESH;
  }

  // A block is a human's verdict on the WORK, not on the branch. Resuming past it
  // would re-run a ticket somebody deliberately stopped, and silently.
  if (input.issueLabels.includes(LORE_BLOCKED_LABEL)) {
    return FRESH;
  }

  // A dirty terminal outcome means the last attempt reached a conclusion and it was
  // a bad one. A null outcome means it never reached one at all — a pod that died
  // mid-round — and that is exactly the case worth continuing.
  if (
    input.priorRunOutcome !== null &&
    !CLEAN_OUTCOMES.has(input.priorRunOutcome)
  ) {
    return FRESH;
  }

  return {
    resume: true,
    lineArgs: {
      resumed_from_branch: true,
      ...(input.openPr
        ? { pr_number: input.openPr.number, pr_url: input.openPr.url }
        : {}),
    },
  };
}
