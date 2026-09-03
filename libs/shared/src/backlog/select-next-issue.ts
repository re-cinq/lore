import type { IssueRef } from "../project/lib/github-port.js";
import { LORE_BLOCKED_LABEL, PRIORITY_LABELS } from "./labels.js";

/** Next backlog ticket, or null for an empty backlog (normal, not a failure); pure. Eligible = open + exactly one priority:* label + no lore:blocked, ordered high→medium→low then oldest createdAt; the FR1 "no open Lore PR" filter is the loop driver's job, not this function's. */
export function selectNextIssue(issues: readonly IssueRef[]): IssueRef | null {
  return orderBacklog(issues)[0] ?? null;
}

/** The whole eligible queue in pick order — the repo tab's "next up" (FR9/FR10); same eligibility and ordering as the picker. */
export function orderBacklog(issues: readonly IssueRef[]): IssueRef[] {
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

  return eligible.map((c) => c.issue);
}

/** Plain lexicographic compare — correct for ISO timestamps, and not subject to the process's collation locale. */
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
