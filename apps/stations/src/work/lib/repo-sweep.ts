// What a sweep over every onboarded repository through lore-api shares: one call a repo, each answer read whole and judged, and a tally said in one line.

/** What lore-api answered one repo's call with, read whole. */
export interface RepoAnswer {
  status: number;
  body: string;
}

/** A dropped socket or a timeout is that repo's failure, never the sweep's: the next repo still gets its turn. */
export function askFor(
  call: (repo: string) => Promise<RepoAnswer>,
  repo: string,
): Promise<RepoAnswer> {
  return call(repo).catch((err: unknown) => ({
    status: 0,
    body: (err as Error).message,
  }));
}

/** How a refused call reads in the log: the error of a dropped socket, or the status and the start of the body. */
export function refusedLine(repo: string, answer: RepoAnswer): string {
  return answer.status === 0
    ? `${repo}: ${answer.body}`
    : `${repo}: HTTP ${answer.status} ${answer.body.slice(0, 300)}`;
}

export function counted<Outcome extends string>(
  tally: Record<Outcome, string[]>,
  outcome: Outcome,
): string {
  const repos = tally[outcome];

  return repos.length === 0
    ? `0 ${outcome}`
    : `${repos.length} ${outcome} (${repos.join(", ")})`;
}
