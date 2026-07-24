// The spend view's selectable time window. `floorSql` is a compile-time
// constant SQL expression for the inclusive lower bound — never user input —
// and `resolveSpendPeriod` only ever returns one of these fixed entries, so
// interpolating `floorSql` into a query is injection-safe.

export type SpendPeriodKey = "week" | "month" | "30d" | "90d" | "all";

export interface SpendPeriod {
  key: SpendPeriodKey;
  /** Full label, e.g. for section headings. */
  label: string;
  /** Short label for the selector chip. */
  short: string;
  /** Constant SQL lower bound (inclusive). Safe to inline. */
  floorSql: string;
}

const PERIODS: Record<SpendPeriodKey, SpendPeriod> = {
  week: {
    key: "week",
    label: "This week",
    short: "Week",
    // date_trunc('week') is ISO — the week starts Monday, not Sunday.
    floorSql: "date_trunc('week', current_date)",
  },
  month: {
    key: "month",
    label: "This month",
    short: "Month",
    floorSql: "date_trunc('month', current_date)",
  },
  "30d": {
    key: "30d",
    label: "Last 30 days",
    short: "30 days",
    floorSql: "current_date - interval '30 days'",
  },
  "90d": {
    key: "90d",
    label: "Last 90 days",
    short: "90 days",
    floorSql: "current_date - interval '90 days'",
  },
  all: {
    key: "all",
    label: "All time",
    short: "All",
    floorSql: "date '2000-01-01'",
  },
};

/** The periods in selector order. */
export const SPEND_PERIODS: SpendPeriod[] = [
  PERIODS.week,
  PERIODS.month,
  PERIODS["30d"],
  PERIODS["90d"],
  PERIODS.all,
];

/** Resolve a raw `?period=` value to a known period, defaulting to this month. */
export function resolveSpendPeriod(raw: string | undefined): SpendPeriod {
  return (raw && PERIODS[raw as SpendPeriodKey]) || PERIODS.month;
}
