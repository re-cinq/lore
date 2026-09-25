import type { DigestGroupBy } from "../../domain/digest-settings.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import type { Implemented } from "./dedupe.js";

/** Bucketing for the digest's two lists (specs/daily-digest FR5): by the person who did or owns the work, or by the `area:*` label the work carries. */

export type DigestChange = PullRef | IssueRef;

export interface DigestGroup {
  key: string;
  changes: DigestChange[];
}

interface KeyedChange {
  change: DigestChange;
  keys: string[];
}

const AREA_PREFIX = "area:";

export const UNLABELED = "unlabeled";
export const UNASSIGNED = "unassigned";

export function groupImplemented(
  { prs, issues }: Implemented,
  by: DigestGroupBy,
): DigestGroup[] {
  const keyedPrs = prs.map((pr) => ({
    change: pr,
    keys: by === "person" ? [pr.author || UNASSIGNED] : areasOf(pr),
  }));
  const keyedIssues = issues.map((issue) => keyedIssue(issue, by));

  return bucket([...keyedPrs, ...keyedIssues]);
}

/** Only owned work is roadmap: an open issue nobody is assigned to says nothing about who is busy with what. */
export function groupRoadmap(
  issues: IssueRef[],
  by: DigestGroupBy,
): DigestGroup[] {
  const owned = issues.filter((issue) => (issue.assignees ?? []).length > 0);

  return bucket(owned.map((issue) => keyedIssue(issue, by)));
}

function keyedIssue(issue: IssueRef, by: DigestGroupBy): KeyedChange {
  return {
    change: issue,
    keys: by === "person" ? peopleOf(issue) : areasOf(issue),
  };
}

function peopleOf(issue: IssueRef): string[] {
  const assignees = issue.assignees ?? [];

  return assignees.length > 0 ? assignees : [UNASSIGNED];
}

function areasOf(change: DigestChange): string[] {
  const areaLabels = change.labels.filter((label) =>
    label.startsWith(AREA_PREFIX),
  );
  const areas = areaLabels.map((label) => label.slice(AREA_PREFIX.length));

  return areas.length > 0 ? areas : [UNLABELED];
}

/** One (key, change) pair per key a change carries, folded into groups sorted by key; a change under two keys appears under both. */
function bucket(keyed: KeyedChange[]): DigestGroup[] {
  const pairs = keyed.flatMap(({ change, keys }) =>
    keys.map((key) => ({ key, change })),
  );
  const groups = pairs.reduce(
    (acc, { key, change }) => acc.set(key, [...(acc.get(key) ?? []), change]),
    new Map<string, DigestChange[]>(),
  );

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, changes]) => ({ key, changes }));
}
