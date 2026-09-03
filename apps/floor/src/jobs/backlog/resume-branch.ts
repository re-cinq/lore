// Whether a backlog tick continues the branch a previous attempt left behind, or starts the ticket over (specs/implementation-loop FR11) — continuing is now the default, but only for a branch nobody has ruled on; pure, since every input is a fact someone else already read.

import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared";

export interface BranchResumeInput {
  /** `undefined` when the port could not answer — unknown, never "no". */
  branchExists: boolean | undefined;
  issueLabels: readonly string[];
  openPr: { number: number; url: string } | null;
}

export type BranchResume =
  { resume: false } | { resume: true; lineArgs: Record<string, unknown> };

const FRESH: BranchResume = { resume: false };

export function decideBranchResume(input: BranchResumeInput): BranchResume {
  // Deleting the branch IS the restart protocol — the repo owner's only lever.
  if (input.branchExists !== true) {
    return FRESH;
  }

  // A block is a human's verdict on the WORK, not the branch — resuming past it would silently re-run a ticket somebody deliberately stopped.
  if (input.issueLabels.includes(LORE_BLOCKED_LABEL)) {
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
