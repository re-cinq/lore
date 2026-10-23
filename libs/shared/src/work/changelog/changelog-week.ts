import type { ChangelogChange } from "../../domain/models/changelog-week.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import { dedupeChanges } from "../digest/dedupe.js";
import { isoWeekKey } from "../digest/iso-week.js";

/** A repo's week of work (specs/repo-changelog): ISO weeks in UTC, Monday 00:00 to the next Monday 00:00, and what merged and closed inside one. */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface WeekBounds {
  /** Inclusive, ISO. */
  from: string;
  /** Exclusive, ISO: the next week's Monday. */
  to: string;
}

export function isoWeekBounds(weekKey: string): WeekBounds {
  const [year, week] = weekKey.split("-W").map(Number);
  const monday = mondayOf(new Date(Date.UTC(year, 0, 4)));
  const from = monday.getTime() + (week - 1) * WEEK_MS;

  return {
    from: new Date(from).toISOString(),
    to: new Date(from + WEEK_MS).toISOString(),
  };
}

/** The last `count` weeks that have ended at `now`, newest first. */
export function finishedWeeks(now: Date, count: number): string[] {
  const thisMonday = mondayOf(now).getTime();

  return Array.from({ length: count }, (_, i) =>
    isoWeekKey(new Date(thisMonday - (i + 1) * WEEK_MS), "UTC"),
  );
}

/** Midnight UTC of the Monday of the ISO week `day` falls in. */
function mondayOf(day: Date): Date {
  const midnight = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
  );

  return new Date(midnight - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

export interface ClosedWork {
  merged: PullRef[];
  closed: IssueRef[];
}

/** What merged and closed inside the week, newest first; an issue a PR of the week closes is listed once, as the PR. */
export function weekChanges(
  { merged, closed }: ClosedWork,
  { from, to }: WeekBounds,
): ChangelogChange[] {
  const inWeek = (at: string | undefined) =>
    at !== undefined && within(at, from, to);
  const { prs, issues } = dedupeChanges(
    merged.filter((pr) => inWeek(pr.mergedAt)),
    closed.filter((issue) => inWeek(issue.closedAt)),
  );

  return [...prs.map(prChange), ...issues.map(issueChange)].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
}

/** Compared as instants: GitHub writes `…Z` without milliseconds, the bounds carry them. */
function within(at: string, from: string, to: string): boolean {
  const time = Date.parse(at);

  return time >= Date.parse(from) && time < Date.parse(to);
}

function prChange(pr: PullRef): ChangelogChange {
  return {
    kind: "pr",
    number: pr.number,
    title: pr.title,
    url: pr.url,
    people: pr.author ? [pr.author] : [],
    at: pr.mergedAt ?? "",
  };
}

function issueChange(issue: IssueRef): ChangelogChange {
  return {
    kind: "issue",
    number: issue.number,
    title: issue.title,
    url: issue.url ?? "",
    people: issue.assignees ?? [],
    at: issue.closedAt ?? "",
  };
}
