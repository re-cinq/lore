import type { IssueRef } from "../project/lib/github-port.js";
import { LORE_BLOCKED_LABEL, PRIORITY_LABELS } from "./labels.js";

/**
 * The next ticket the implementation loop should work, or null for an empty
 * backlog (a normal state, not a failure). Pure — the caller supplies the
 * issue records and stays responsible for excluding issues already referenced
 * by an open Lore-authored PR.
 *
 * Eligible = open, exactly one `priority:*` label, no `lore:blocked`. More
 * than one priority label is ineligible on purpose: the ambiguity surfaces to
 * a human instead of being guessed at. Order: high → medium → low, ties by
 * oldest createdAt (undated candidates sort last). The FR1 "no open
 * Lore-authored PR" clause is the loop driver's guard, not a filter here — it
 * needs task and PR state this function deliberately does not see.
 */
export function selectNextIssue(issues: readonly IssueRef[]): IssueRef | null {
  const eligible = issues.flatMap((issue) => {
    if (issue.state !== "open") {
      return [];
    }

    if (issue.labels.includes(LORE_BLOCKED_LABEL)) {
      return [];
    }
    const rank = priorityRank(issue.labels);

    return rank === null ? [] : [{ issue, rank }];
  });

  eligible.sort(
    (a, b) =>
      a.rank - b.rank ||
      compareIso(createdAtOrder(a.issue), createdAtOrder(b.issue)),
  );

  return eligible[0]?.issue ?? null;
}

/** Plain lexicographic compare — correct for ISO timestamps, and not subject
 *  to whatever collation locale the process happens to run under. */
function compareIso(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

function priorityRank(labels: readonly string[]): number | null {
  const carried = PRIORITY_LABELS.filter((p) => labels.includes(p));

  if (carried.length !== 1) {
    return null;
  }

  return PRIORITY_LABELS.indexOf(carried[0]);
}

function createdAtOrder(issue: IssueRef): string {
  // "￿" sorts after every ISO timestamp, pushing undated issues last.
  return issue.createdAt ?? "￿";
}
