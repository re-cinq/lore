// Which lines of a spec on the branch this plan's writer wrote: all of them for a spec the plan creates, and for one it updates, only the lines the default branch does not have. The gate judges the writer on those alone: an older spec's stale names and compound requirements were there before this plan, and a repair visit that rewrote them would be editing what nobody asked for (lore's plan 64e50ec3 died on 30 names in a spec it only reworded).

export interface LineFinding {
  /** 1-based line of the spec the finding is on. */
  line: number;
}

/** The 1-based lines of `onBranch` that `onBase` does not hold, line for line; every line when there is no base text. */
export function changedLines(
  onBranch: string,
  onBase: string | null,
): Set<number> {
  const base = new Set(onBase?.split("\n") ?? []);

  return new Set(
    onBranch
      .split("\n")
      .flatMap((line, index) => (base.has(line) ? [] : [index + 1])),
  );
}

/** Only the findings on lines the writer wrote. */
export function onChangedLines<T extends LineFinding>(
  findings: readonly T[],
  changed: ReadonlySet<number>,
): T[] {
  return findings.filter((finding) => changed.has(finding.line));
}
