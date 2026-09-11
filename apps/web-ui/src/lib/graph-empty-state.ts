/** The last commit each CI projection landed for a repo; null when that kind never ran. */
export interface ProjectionCommits {
  specs: string | null;
  adrs: string | null;
  testReport: string | null;
}

/** Why an empty graph is empty: nothing ever projected, tests landed with no docs to link them to, or docs landed with no linking statement. */
export type GraphEmptyReason =
  | { kind: "never-projected" }
  | { kind: "tests-only"; commit: string }
  | { kind: "docs-unlinked"; commit: string };

/** The graph is rooted in specs, so tests alone leave it empty however much CI projected; only the doc kinds can put a node on it. */
export function decideGraphEmptyReason(
  commits: ProjectionCommits,
): GraphEmptyReason {
  const docsCommit = commits.specs ?? commits.adrs;

  if (docsCommit !== null) {
    return { kind: "docs-unlinked", commit: docsCommit };
  }

  if (commits.testReport !== null) {
    return { kind: "tests-only", commit: commits.testReport };
  }

  return { kind: "never-projected" };
}
