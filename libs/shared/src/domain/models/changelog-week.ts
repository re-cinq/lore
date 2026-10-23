import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.changelog_weeks` — one row per repo per finished ISO week (specs/repo-changelog): what merged and closed that week, and the introduction an agent wrote about it once the week ended. */

export const ChangelogChangeSchema = z.object({
  kind: z.enum(["pr", "issue"]),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  /** The PR's author, or the issue's assignees. */
  people: z.array(z.string()),
  /** When it merged or closed, ISO. */
  at: z.string(),
});

export type ChangelogChange = z.infer<typeof ChangelogChangeSchema>;

export const ChangelogWeekSchema = z.object({
  repo: z.string(),
  /** ISO week in UTC, `2026-W43`. */
  weekKey: z.string(),
  /** Empty when the week had nothing in it or the agent wrote nothing. */
  intro: z.string(),
  changes: z.array(ChangelogChangeSchema),
  writtenAt: z.date(),
});

export type ChangelogWeek = z.infer<typeof ChangelogWeekSchema>;

export const CHANGELOG_WEEK_COLUMNS = {
  repo: "repo",
  weekKey: "week_key",
  intro: "intro",
  changes: "changes",
  writtenAt: "written_at",
} as const satisfies ColumnMap<ChangelogWeek>;

export const CHANGELOG_WEEK_TABLE = "lore.changelog_weeks";
