/** Business-hours gating for safety-net crons, via LORE_BUSINESS_HOURS_{TZ,START,END}/LORE_BUSINESS_DAYS (default Europe/Berlin 9-18 Mon-Fri). */

const WEEKDAY_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function parseHour(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;

  if (Number.isNaN(n) || n < 0 || n > 23) {
    return fallback;
  }

  return n;
}

function isValidDay(n: number): boolean {
  return !Number.isNaN(n) && n >= 1 && n <= 7;
}

function parseDays(raw: string | undefined): Set<number> {
  const src = raw && raw.trim() ? raw : "1,2,3,4,5";
  const parsed = src.split(",").map((token) => parseInt(token.trim(), 10));
  const out = new Set(parsed.filter(isValidDay));

  return out.size > 0 ? out : new Set([1, 2, 3, 4, 5]);
}

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: string,
  fallback: string,
): string {
  const match = parts.find((p) => p.type === type);

  return match ? match.value : fallback;
}

function currentHourAndWeekday(
  now: Date,
  tz: string,
): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const hour = parseInt(partValue(parts, "hour", "0"), 10);
  const weekday = weekdayToIso(partValue(parts, "weekday", "Mon"));

  return { hour, weekday };
}

export function isBusinessHours(now: Date = new Date()): boolean {
  const tz = process.env.LORE_BUSINESS_HOURS_TZ || "Europe/Berlin";
  const start = parseHour(process.env.LORE_BUSINESS_HOURS_START, 9);
  const end = parseHour(process.env.LORE_BUSINESS_HOURS_END, 18);
  const days = parseDays(process.env.LORE_BUSINESS_DAYS);
  const { hour, weekday } = currentHourAndWeekday(now, tz);

  if (!days.has(weekday)) {
    return false;
  }

  return hour >= start && hour < end;
}

function weekdayToIso(short: string): number {
  return WEEKDAY_ISO[short] ?? 0;
}
