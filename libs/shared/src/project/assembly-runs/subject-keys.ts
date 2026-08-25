// What a run WORKS ON, spelled once.
//
// `subject_key` is a wire format between two images: the Floor stamps it when it
// starts a run, lore-api asks for the same string when it answers "is something
// already working this?". Spelling it independently on each side is not a mismatch
// the compiler can catch — it is a query that quietly finds nothing, which reads
// exactly like "nothing is in flight", which is the bug the key exists to prevent.
// So every producer and every reader builds its key here.
//
// A key names the SUBJECT, never the action. `feature:<id>` is what lets one query
// find a feature's planning run AND its finalize run; `feature:<id>:finalize` would
// guard repeat finalizes while still allowing two lines to work one feature at once.
//
// The families share a `<family>:<...>` shape so a key is self-describing in the
// table, and are prefix-disjoint so no two families can ever collide.

/** One run per feature — planning, finalize and decomposition all share it. */
export function featureSubject(featureId: string): string {
  return `feature:${featureId}`;
}

/** One detection run per blueprint per repo. */
export function detectSubject(blueprintName: string, repo: string): string {
  return `detect:${blueprintName}:${repo}`;
}

/** One review per PR. The repo is the guard's other half — the index is on
 *  `(repo, subject_key)` — so it is not repeated here. */
export function reviewSubject(prNumber: number): string {
  return `review:pr-${prNumber}`;
}

/**
 * One ingest run per unit of WORK, not per commit.
 *
 * Chunked work — a posted test-report/coverage chunk identified by its scheduling
 * event, or a force pass's per-directory glob — carries its chunk identity. Dropping
 * it makes sibling chunks read as duplicates of each other, which silently dropped
 * all but ~1 of 40 test-report chunks per push (2026-07-31).
 */
export function ingestSubject(
  kind: string,
  ref: string,
  chunk?: string,
): string {
  const base = `ingest:${kind}:${ref}`;

  return chunk ? `${base}:${chunk}` : base;
}

/** One backlog loop run per repo (implementation-loop FR2). The subject is the
 *  repo's backlog itself, and the repo is the guard's other half — the unique
 *  index is on `(repo, subject_key)` — so the key carries no repo, exactly as
 *  `reviewSubject` carries none. */
export function backlogSubject(): string {
  return "backlog";
}
