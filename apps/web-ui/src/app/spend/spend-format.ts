import type { BudgetRow } from "./SpendView";

export const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

export const num = (n: number) => Number(n).toLocaleString();

/** Render YYYY-MM-DD as DD-MM-YYYY: parse string not Date to avoid UTC shift, fixed locale for consistency. */
export const day = (isoDay: string) => {
  const [year, month, dayOfMonth] = isoDay.split("-");

  return `${dayOfMonth}-${month}-${year}`;
};

/** A timestamp as day-month-year plus a 24-hour clock, for the same reasons. */
export const stamp = (iso: string) => {
  const t = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${pad(t.getDate())}-${pad(t.getMonth() + 1)}-${t.getFullYear()} ` +
    `${pad(t.getHours())}:${pad(t.getMinutes())}`
  );
};

const MS_PER_DAY = 86_400_000;

/** Local midnight for a `YYYY-MM-DD` day, for the reason `day` gives. */
const midnight = (isoDay: string) => {
  const [year, month, dayOfMonth] = isoDay.split("-").map(Number);

  return new Date(year, month - 1, dayOfMonth);
};

/** Anchor day: parse as string, not Date, to avoid UTC→local timezone shift. */
export const anchorDay = (anchoredAt: string) => anchoredAt.slice(0, 10);

/** Clock part, or null if entry anchors to start of day (no known time). */
export const anchorTime = (anchoredAt: string) => {
  const clock = anchoredAt.slice(11, 16);

  return !clock || clock === "00:00" ? null : clock;
};

/** Daily burn rate and projected runway from anchor; null if anchor is future or no spend yet. */
export function budgetOutlook(
  budget: NonNullable<BudgetRow>,
  today: Date,
): { burnPerDay: number; daysLeft: number } | null {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const elapsedDays =
    Math.round(
      (startOfToday.getTime() -
        midnight(anchorDay(budget.anchored_at)).getTime()) /
        MS_PER_DAY,
    ) + 1;

  if (elapsedDays < 1 || budget.spent_since_usd <= 0) {
    return null;
  }
  const burnPerDay = budget.spent_since_usd / elapsedDays;

  return {
    burnPerDay,
    daysLeft: Math.max(0, Math.floor(budget.remaining_usd / burnPerDay)),
  };
}
