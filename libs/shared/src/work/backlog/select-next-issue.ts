import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import { LORE_BLOCKED_LABEL, PRIORITY_LABELS } from "./labels.js";

export type RankingCriterion = "priority" | "age" | "unblocks" | "size";

export interface RankingOptions {
  criteria?: RankingCriterion[];
}

const DEFAULT_CRITERIA: RankingCriterion[] = ["priority", "age"];

/** size:S < size:M < size:L; no label sorts after all lettered sizes. */
const SIZE_ORDER: Record<string, number> = { S: 0, M: 1, L: 2 };

interface RankedIssue {
  issue: IssueRef;
  rank: number;
}

/** Next backlog ticket, or null for an empty backlog (normal, not a failure); pure. Eligible = open + exactly one priority:* label + no lore:blocked, ordered by `options.criteria` (default: priority then age); the FR1 "no open Lore PR" filter is the loop driver's job, not this function's. */
export function selectNextIssue(
  issues: readonly IssueRef[],
  options?: RankingOptions,
): IssueRef | null {
  return orderBacklog(issues, options)[0] ?? null;
}

/** The whole eligible queue in pick order — the repo tab's "next up" (FR9/FR10); same eligibility and ordering as the picker. */
export function orderBacklog(
  issues: readonly IssueRef[],
  options?: RankingOptions,
): IssueRef[] {
  const criteria = options?.criteria ?? DEFAULT_CRITERIA;
  const eligible = issues.flatMap((i) => {
    const e = toEligible(i);

    return e === null ? [] : [e];
  });

  eligible.sort((a, b) => {
    for (const criterion of criteria) {
      const diff = compareByCriterion(criterion, a, b);

      if (diff !== 0) {
        return diff;
      }
    }

    return 0;
  });

  return eligible.map((c) => c.issue);
}

function toEligible(issue: IssueRef): RankedIssue | null {
  if (issue.state !== "open") {
    return null;
  }

  if (issue.labels.includes(LORE_BLOCKED_LABEL)) {
    return null;
  }
  const rank = priorityRank(issue.labels);

  return rank === null ? null : { issue, rank };
}

/** The open tickets someone queued that the picker leaves out: parked ones (`lore:blocked`) and ones carrying two priority labels. The backlog page lists them with why, since `orderBacklog` drops them without a word. Oldest first. */
export function heldBacklog(issues: readonly IssueRef[]): IssueRef[] {
  const queue = new Set(orderBacklog(issues));

  return issues
    .filter((issue) => issue.state === "open" && !queue.has(issue))
    .filter((issue) => PRIORITY_LABELS.some((p) => issue.labels.includes(p)))
    .sort((a, b) => compareIso(createdAtOrder(a), createdAtOrder(b)));
}

function compareByCriterion(
  criterion: RankingCriterion,
  a: RankedIssue,
  b: RankedIssue,
): number {
  switch (criterion) {
    case "priority":
      return a.rank - b.rank;
    case "age":
      return compareIso(createdAtOrder(a.issue), createdAtOrder(b.issue));
    case "unblocks":
      return unblockCount(b.issue) - unblockCount(a.issue);
    case "size":
      return sizeRank(a.issue.labels) - sizeRank(b.issue.labels);
  }
}

function unblockCount(issue: IssueRef): number {
  return issue.blockedByCount ?? 0;
}

function sizeRank(labels: readonly string[]): number {
  for (const label of labels) {
    if (!label.startsWith("size:")) {
      continue;
    }
    const key = label.slice(5);
    const rank = (SIZE_ORDER as Record<string, number | undefined>)[key];

    if (rank !== undefined) {
      return rank;
    }
  }

  return Object.keys(SIZE_ORDER).length;
}

/** Plain lexicographic compare — correct for ISO timestamps, and not subject to the process's collation locale. */
function compareIso(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
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
