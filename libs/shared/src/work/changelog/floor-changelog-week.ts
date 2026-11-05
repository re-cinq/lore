// Starts one repository's week on the floor's weekly-changelog line (specs/repo-changelog): by the Monday tick, or by hand from the Changelog tab for a week left without an introduction.
import type { FloorClient, StartedRun } from "@re-cinq/floor-client";
import { floorRepoOf, valueItem } from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";

const WEEKLY_CHANGELOG_LINE = "weekly-changelog";

export type ChangelogLineStarter = Pick<FloorClient["lines"], "start">;

export interface RepoWeek {
  repo: string;
  week: string;
}

/** Keyed on the repo and the week, so a second start joins an open run instead of starting another; the store overwrites the week's row. */
export function startChangelogWeek(
  lines: ChangelogLineStarter,
  { repo, week }: RepoWeek,
): Promise<StartedRun> {
  return startLine(lines, WEEKLY_CHANGELOG_LINE, {
    repo: floorRepoOf(repo),
    startItems: {
      changelog_key: valueItem(`${repo}:${week}`),
      changelog_repo: valueItem(repo),
      week_key: valueItem(week),
    },
  });
}
