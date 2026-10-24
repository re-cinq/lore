import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import { LORE_BLOCKED_LABEL, PRIORITY_LABELS } from "./labels.js";

export type RankingCriterion = "priority" | "age" | "unblocks" | "size";

export interface RankingOptions {
  criteria?: RankingCriterion[];
}

const DEFAULT_CRITERIA: RankingCriterion[] = ["priority", "age"];

/** size:S < size:M < size:L; no label sorts after all lettered sizes. */
const SIZE_ORDER: Record<string, number> = { S: 0, M: 1, L: 2 };

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

  eligible.sort((a, b) => {
    for (const criterion of criteria) {
      const diff = compareByCriterion(
        criterion,
        a.issue,
        b.issue,
        a.rank,
        b.rank,
      );
      if (diff !== 0) return diff;
    }
    return 0;
  });

  return eligible.map((c) => c.issue);
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
  a: IssueRef,
  b: IssueRef,
  aRank: number,
  bRank: number,
): number {
  switch (criterion) {
    case "priority":
      return aRank - bRank;
    case "age":
      return compareIso(createdAtOrder(a), createdAtOrder(b));
    case "unblocks":
      // more blockedByCount = picked first (descending)
      return (b.blockedByCount ?? 0) - (a.blockedByCount ?? 0);
    case "size":
      return sizeRank(a.labels) - sizeRank(b.labels);
  }
}

function sizeRank(labels: readonly string[]): number {
  for (const label of labels) {
    if (label.startsWith("size:")) {
      const key = label.slice(5);
      const rank = SIZE_ORDER[key];
      if (rank !== undefined) return rank;
    }
  }
  return Object.keys(SIZE_ORDER).length;
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
