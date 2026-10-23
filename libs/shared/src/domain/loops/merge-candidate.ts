// Which open pull requests the auto-merge loop may take (specs/protected-branch-merge).

export interface CandidatePull {
  state: string;
  draft?: boolean;
  /** `owner/name` of the repository the head branch lives in. */
  headRepo?: string;
}

/** Open, ready for review, and on a branch of this repository: a fork's branch is not one Lore can push a fix to. */
export function mergeCandidate(pull: CandidatePull, repo: string): boolean {
  const ownBranch =
    pull.headRepo === undefined ||
    pull.headRepo.toLowerCase() === repo.toLowerCase();

  return pull.state === "open" && pull.draft !== true && ownBranch;
}
