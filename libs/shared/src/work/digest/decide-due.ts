import type { ResolvedDigestSettings } from "../../domain/digest-settings.js";

/** Whether a repo's digest is due now (specs/daily-digest FR2): enabled, today is one of its days, its time of day has passed, and nothing was posted yet today — all read in the repo's own timezone. */

export interface LocalParts {
  /** `YYYY-MM-DD` in the timezone. */
  date: string;
  /** JS `getDay()` convention: Sunday is 0. */
  weekday: number;
  /** `HH:MM`, 24-hour. */
  hhmm: string;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    weekday: WEEKDAYS[read("weekday")] ?? 0,
    hhmm: `${read("hour")}:${read("minute")}`,
  };
}

/** When a recurring job runs: the days (JS `getDay()`), the local time of day and the IANA timezone both are read in. */
export interface Schedule {
  enabled: boolean;
  days: number[];
  time: string;
  timezone: string;
}

/** Whether a schedule is due at `now`: enabled, today is one of its days, its time has passed, and the last run was not today, all in the schedule's timezone. */
export function decideScheduleDue(
  { enabled, days, time, timezone }: Schedule,
  now: Date,
  lastRunAt: Date | null,
): boolean {
  if (!enabled) {
    return false;
  }
  const today = localParts(now, timezone);
  const ranToday =
    lastRunAt !== null && localParts(lastRunAt, timezone).date === today.date;

  return days.includes(today.weekday) && today.hhmm >= time && !ranToday;
}

export interface DigestDueInput {
  settings: ResolvedDigestSettings;
  now: Date;
  lastPostedAt: Date | null;
}

export function decideDigestDue({
  settings,
  now,
  lastPostedAt,
}: DigestDueInput): boolean {
  return decideScheduleDue(settings, now, lastPostedAt);
}
