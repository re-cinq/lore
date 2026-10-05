import type { PullDraft, PullRef } from "./pull-requests-port.js";

/** The slice of a repository's pull requests an opening station needs. */
export interface PullOpener {
  list(): Promise<PullRef[]>;
  open(branch: string, pr: PullDraft): Promise<PullRef>;
}

/** The pull request already open on the branch, or a new one: a station dispatched twice must never fork review across two pull requests. */
export async function ensurePull(
  pulls: PullOpener,
  branch: string,
  draft: PullDraft,
): Promise<PullRef> {
  const open = await pulls.list();

  return (
    open.find((pr) => pr.branch === branch) ?? (await pulls.open(branch, draft))
  );
}
