/** Business-hours gating for safety-net crons, via LORE_BUSINESS_HOURS_{TZ,START,END}/LORE_BUSINESS_DAYS (default Europe/Berlin 9-18 Mon-Fri). */

function parseHour(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;

  if (Number.isNaN(n) || n < 0 || n > 23) {
    return fallback;
  }

  return n;
}

function parseDays(raw: string | undefined): Set<number> {
  const src = raw && raw.trim() ? raw : "1,2,3,4,5";
  const out = new Set<number>();

  for (const token of src.split(",")) {
    const n = parseInt(token.trim(), 10);

    if (!Number.isNaN(n) && n >= 1 && n <= 7) {
      out.add(n);
    }
  }

  return out.size > 0 ? out : new Set([1, 2, 3, 4, 5]);
}

export function isBusinessHours(now: Date = new Date()): boolean {
  const tz = process.env.LORE_BUSINESS_HOURS_TZ || "Europe/Berlin";
  const start = parseHour(process.env.LORE_BUSINESS_HOURS_START, 9);
  const end = parseHour(process.env.LORE_BUSINESS_HOURS_END, 18);
  const days = parseDays(process.env.LORE_BUSINESS_DAYS);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Mon";

  const hour = parseInt(hourStr, 10);
  const weekday = weekdayToIso(weekdayStr);

  if (!days.has(weekday)) {
    return false;
  }

  return hour >= start && hour < end;
}

function weekdayToIso(short: string): number {
  switch (short) {
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    case "Sun":
      return 7;
    default:
      return 0;
  }
}
