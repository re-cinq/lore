// What a run WORKS ON, spelled once — subject_key is a wire format between the Floor and lore-api, and a mismatched spelling wouldn't fail to compile, it would just silently find nothing in flight.

/** One run per plan — drafting, the spec PR and decomposition all share it. */
export function planSubject(planId: string): string {
  return `plan:${planId}`;
}

/** One detection run per blueprint per repo. */
export function detectSubject(blueprintName: string, repo: string): string {
  return `detect:${blueprintName}:${repo}`;
}

/** One review per PR; the repo is the guard's other half (index on (repo, subject_key)), so it's not repeated here. */
export function reviewSubject(prNumber: number): string {
  return `review:pr-${prNumber}`;
}

/** One ingest run per unit of WORK, not per commit — dropping the chunk identity made sibling chunks read as duplicates, silently dropping ~39 of 40 test-report chunks per push (2026-07-31). */
export function ingestSubject(
  kind: string,
  ref: string,
  chunk?: string,
): string {
  const base = `ingest:${kind}:${ref}`;

  return chunk ? `${base}:${chunk}` : base;
}

/** One backlog loop run per repo (implementation-loop FR2); repo is the guard's other half (index on (repo, subject_key)), so the key carries none, like reviewSubject. */
export function backlogSubject(): string {
  return "backlog";
}

/** Branch one backlog ticket's work lives on, keyed on the ISSUE not the task — a task-derived name gave a re-picked ticket a fresh branch each time and abandoned prior commits (implementation-loop FR2). */
export function implementationLoopBranch(issueNumber: number): string {
  return `lore/implementation-loop/issue-${issueNumber}`;
}

/** One daily-digest run per Slack channel per scheduled slot of a local day (specs/daily-digest FR8): repos on one channel scheduled at different times are different runs, each under its own cap. The repo half of the guard is the channel's host repo. */
export function digestSubject(
  channelId: string,
  localDate: string,
  time: string,
): string {
  return `digest:${channelId}:${localDate}:${time}`;
}
