import type { PullDraft, PullRef } from "./pull-requests-port.js";

/** The slice of a repository's pull requests an opening station needs. */
export interface PullOpener {
  list(): Promise<PullRef[]>;
  open(branch: string, pr: PullDraft): Promise<PullRef>;
}

/** The pull request already open on the branch, or a new one: a station dispatched twice must never fork review across two pull requests. A station that has something to bring an already-open pull request up to date passes it as `reused`. */
export async function ensurePull(
  pulls: PullOpener,
  branch: string,
  draft: PullDraft,
  reused?: (pr: PullRef) => Promise<void>,
): Promise<PullRef> {
  const open = await pulls.list();
  const existing = open.find((pr) => pr.branch === branch);

  if (!existing) {
    return pulls.open(branch, draft);
  }
  await reused?.(existing);

  return existing;
}
