// Pure interval selector: preset → YYYY-MM-DD bounds, testable without DOM
export type SpendPreset = "today" | "7d" | "30d" | "mtd";

const DAY_MS = 24 * 60 * 60 * 1000;

const day = (d: Date): string => d.toISOString().slice(0, 10);

export function presetInterval(
  preset: SpendPreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = day(now);

  switch (preset) {
    case "today":
      return { from: to, to };
    case "7d":
      return { from: day(new Date(now.getTime() - 7 * DAY_MS)), to };
    case "30d":
      return { from: day(new Date(now.getTime() - 30 * DAY_MS)), to };
    case "mtd":
      return { from: `${to.slice(0, 8)}01`, to };
  }
}

/** Query string for interval; single source of truth for parameter names. */
export function spendWindowQuery(interval: {
  from: string;
  to: string;
}): string {
  return `from=${interval.from}&to=${interval.to}`;
}
