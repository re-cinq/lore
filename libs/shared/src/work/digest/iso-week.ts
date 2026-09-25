import { localParts } from "./decide-due.js";

/** The ISO-8601 week a moment falls in, read in a timezone — the key of a channel's weekly Slack thread (specs/daily-digest FR7). */
export function isoWeekKey(now: Date, timeZone: string): string {
  const { date } = localParts(now, timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const thursday = new Date(Date.UTC(year, month - 1, day));

  // ISO weeks belong to the year of their Thursday.
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));

  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
