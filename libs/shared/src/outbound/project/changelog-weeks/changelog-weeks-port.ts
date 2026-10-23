import type { ChangelogWeek } from "../../../domain/models/changelog-week.js";

/** `lore.changelog_weeks` (specs/repo-changelog): one row per repo per finished week, written once by the weekly-changelog line. */

export type ChangelogWeekWrite = Omit<ChangelogWeek, "writtenAt">;

export interface ChangelogWeeksPort {
  /** Writes the week, replacing a row a by-hand rerun of the same week already wrote. */
  upsert(week: ChangelogWeekWrite): Promise<void>;
  /** Which of these weeks already have a row for the repo. */
  writtenWeeks(repo: string, weekKeys: string[]): Promise<string[]>;
  /** The repo's weeks newest first, those before `before` when it is given. */
  page(
    repo: string,
    query: { before?: string; limit: number },
  ): Promise<ChangelogWeek[]>;
}
