import type {
  ChangelogChange,
  ChangelogWeek,
} from "../../domain/models/changelog-week.js";
import { isoWeekKey } from "../digest/iso-week.js";
import {
  finishedWeeks,
  isoWeekBounds,
  weekChanges,
  type ClosedWork,
  type WeekBounds,
} from "./changelog-week.js";

/** One page of a repository's Changelog tab (specs/repo-changelog FR6): finished weeks from `lore.changelog_weeks`, and the current week, or a week nothing stored yet, read live from GitHub without an introduction. */

export interface ChangelogPageWeek extends WeekBounds {
  weekKey: string;
  /** The week still in progress. */
  current: boolean;
  /** Null for a week no introduction was written for yet. */
  intro: string | null;
  changes: ChangelogChange[];
}

export interface ChangelogPage {
  weeks: ChangelogPageWeek[];
  /** The `before` of the next page; null when this page held nothing. */
  next: string | null;
}

export interface ChangelogPageDeps {
  now(): Date;
  /** The repository's stored weeks, newest first. */
  stored(query: { before?: string; limit: number }): Promise<ChangelogWeek[]>;
  /** What merged and closed in the repository since `since`. */
  closedWork(since: string): Promise<ClosedWork>;
}

export async function changelogPage(
  query: { before?: string; limit: number },
  deps: ChangelogPageDeps,
): Promise<ChangelogPage> {
  const current = isoWeekKey(deps.now(), "UTC");
  const keys = pageWeekKeys(query, deps.now(), current);
  const stored = new Map(
    (await deps.stored(query)).map((week) => [week.weekKey, week]),
  );
  const live = await liveChanges(
    keys.filter((key) => !stored.has(key)),
    deps,
  );
  const weeks = keys.map((weekKey) =>
    pageWeek(weekKey, { current, stored: stored.get(weekKey), live }),
  );

  return { weeks, next: hasAnything(weeks) ? (keys.at(-1) ?? null) : null };
}

function pageWeek(
  weekKey: string,
  known: {
    current: string;
    stored: ChangelogWeek | undefined;
    live: Map<string, ChangelogChange[]>;
  },
): ChangelogPageWeek {
  return {
    weekKey,
    ...isoWeekBounds(weekKey),
    current: weekKey === known.current,
    intro: known.stored?.intro ?? null,
    changes: known.stored?.changes ?? known.live.get(weekKey) ?? [],
  };
}

/** Without `before`, the current week leads; with it, the weeks before that one. */
function pageWeekKeys(
  { before, limit }: { before?: string; limit: number },
  now: Date,
  current: string,
): string[] {
  if (before === undefined) {
    return [current, ...finishedWeeks(now, limit - 1)];
  }

  return finishedWeeks(new Date(isoWeekBounds(before).from), limit);
}

/** One GitHub read from the oldest week that needs it, split into those weeks. */
async function liveChanges(
  keys: string[],
  deps: ChangelogPageDeps,
): Promise<Map<string, ChangelogChange[]>> {
  const oldest = keys.at(-1);

  if (oldest === undefined) {
    return new Map();
  }
  const work = await deps.closedWork(isoWeekBounds(oldest).from);

  return new Map(
    keys.map((key) => [key, weekChanges(work, isoWeekBounds(key))]),
  );
}

function hasAnything(weeks: ChangelogPageWeek[]): boolean {
  return weeks.some((week) => week.changes.length > 0 || week.intro !== null);
}
