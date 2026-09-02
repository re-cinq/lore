// The interval selector's pure half: preset → inclusive YYYY-MM-DD bounds.
// Kept out of the panel so the date arithmetic is testable without a DOM and
// the panel cannot drift from what the API's own validation expects.

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

/** The query string for an interval — one place, so the panel and any deep
 *  link agree on the parameter names the API validates. */
export function spendWindowQuery(interval: {
  from: string;
  to: string;
}): string {
  return `from=${interval.from}&to=${interval.to}`;
}
